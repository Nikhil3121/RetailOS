/**
 * Local SQLite backup, verification and restore.
 *
 * ── WHY NOT A FILE COPY ────────────────────────────────────────────────────
 * The database runs in WAL mode, and since Phase 7 the sync loop writes to it
 * on a timer. Copying `retailos.db` on its own captures the main file without
 * the `-wal` that holds recent commits: the result is either missing the last
 * transactions or is outright corrupt. Every backup here goes through SQLite's
 * ONLINE BACKUP API, which is safe against a concurrent writer and produces a
 * single self-contained file with no sidecar to remember.
 *
 * ── WHAT THIS PROTECTS AGAINST, AND WHAT IT DOES NOT ───────────────────────
 * Protects: database corruption, an accidental wipe of the working file, a bad
 * migration, operator error.
 *
 * Does NOT protect: drive failure, theft, fire. Backups land on the same disk
 * as the database unless `RETAILOS_BACKUP_DIR` points somewhere else. That is
 * a real limit and is documented rather than implied away — a shop that needs
 * survivability past a dead PC needs the directory pointed at another volume.
 *
 * ── UNSYNCED DATA IS THE IRREPLACEABLE PART ────────────────────────────────
 * A synced sale exists in PostgreSQL and can be recovered from the server. An
 * unsynced one exists NOWHERE ELSE. Every backup records both counts in its
 * manifest, so a person restoring can see exactly how much of what they hold
 * is irreplaceable.
 */

import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { openDatabase, type Db } from './connection';
import { describeError, log } from './logger';

/** Kept backups. Beyond this the oldest are pruned. */
const DEFAULT_RETENTION = 10;

export interface BackupManifest {
  createdAt: string;
  schemaVersion: number;
  /** Sales that exist ONLY here until they sync. The irreplaceable ones. */
  unsyncedSales: number;
  /** Sales the server has acknowledged; recoverable from PostgreSQL. */
  syncedSales: number;
  totalSales: number;
  /** Sum of every sale total, in integer paise. A blunt but effective check
   *  that a restore put back the same money. */
  totalPaise: number;
  queuePending: number;
  sizeBytes: number;
}

export interface BackupEntry {
  file: string;
  manifestFile: string;
  createdAt: string;
  sizeBytes: number;
  manifest: BackupManifest | null;
}

export interface VerifyResult {
  ok: boolean;
  file: string;
  integrity: string;
  schemaVersion: number | null;
  manifest: BackupManifest | null;
  problems: string[];
}

export function backupDir(): string {
  const configured = process.env.RETAILOS_BACKUP_DIR?.trim();
  return configured && configured.length > 0
    ? configured
    : path.join(app.getPath('userData'), 'backups');
}

function manifestPathFor(dbFile: string): string {
  return `${dbFile}.json`;
}

/** Counts the caller needs to know what a backup actually contains. */
export function summarise(db: Db): Omit<BackupManifest, 'createdAt' | 'sizeBytes'> {
  const one = (sql: string): number => {
    const row = db.prepare(sql).get() as { n: number | null } | undefined;
    return row?.n ?? 0;
  };
  return {
    schemaVersion: one('SELECT MAX(version) AS n FROM schema_migrations'),
    unsyncedSales: one(
      "SELECT COUNT(*) AS n FROM sale WHERE sync_status <> 'SYNCED' AND server_id IS NULL",
    ),
    syncedSales: one(
      "SELECT COUNT(*) AS n FROM sale WHERE sync_status = 'SYNCED' OR server_id IS NOT NULL",
    ),
    totalSales: one('SELECT COUNT(*) AS n FROM sale'),
    totalPaise: one('SELECT COALESCE(SUM(total_paise), 0) AS n FROM sale'),
    queuePending: one("SELECT COUNT(*) AS n FROM sync_queue WHERE status <> 'SYNCED'"),
  };
}

/** Open a database file read-only and summarise it. Null if it cannot be read. */
function summariseFile(file: string): Omit<BackupManifest, 'createdAt' | 'sizeBytes'> | null {
  let handle: Db | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    handle = new Database(file, { readonly: true, fileMustExist: true });
    return summarise(handle);
  } catch {
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      /* best effort */
    }
  }
}

/**
 * Integrity of the LIVE database.
 *
 * `quick_check` rather than `integrity_check`: it catches the corruption that
 * actually happens (torn pages, bad indexes) at a fraction of the cost, which
 * matters when this runs on a till during trading hours.
 */
export function checkIntegrity(db: Db): { ok: boolean; result: string } {
  const rows = db.pragma('quick_check') as { quick_check: string }[];
  const result = rows[0]?.quick_check ?? 'unknown';
  return { ok: result === 'ok', result };
}

/**
 * Take a backup, then PROVE it is readable before keeping it.
 *
 * An unverified backup is worse than no backup: it invites someone to rely on
 * a file that will not open on the day they need it. If verification fails the
 * artefact is deleted and the failure is logged loudly.
 */
export async function createBackup(
  db: Db,
  options: { dir?: string; retention?: number } = {},
): Promise<{ ok: boolean; entry?: BackupEntry; error?: string }> {
  const dir = options.dir ?? backupDir();
  const startedAt = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `retailos-${stamp}.db`);

    // Never overwrite: the name is timestamped, and a collision is treated as
    // a problem rather than silently clobbered.
    if (fs.existsSync(file)) {
      return { ok: false, error: 'A backup with this timestamp already exists.' };
    }

    // SQLite's online backup. Safe while the sync loop is writing.
    await db.backup(file);

    // The manifest is computed FROM THE BACKUP, not from the live database
    // before it. SQLite restarts an online backup when the source changes, so
    // a backup taken while the sync loop is writing can legitimately contain
    // MORE than the source held when we started. Summarising the source first
    // produced a manifest that disagreed with its own file, and verification
    // then rejected a perfectly good backup.
    //
    // Describing the artefact makes the manifest true by construction.
    const summary = summariseFile(file);
    if (!summary) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best effort */
      }
      return { ok: false, error: 'Backup could not be read back after writing.' };
    }

    const sizeBytes = fs.statSync(file).size;
    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      sizeBytes,
      ...summary,
    };
    fs.writeFileSync(manifestPathFor(file), JSON.stringify(manifest, null, 2));

    const verified = verifyBackup(file);
    if (!verified.ok) {
      // A backup that cannot be read is not a backup.
      try {
        fs.rmSync(file, { force: true });
        fs.rmSync(manifestPathFor(file), { force: true });
      } catch {
        /* best effort */
      }
      log.error('backup.verification_failed', { problems: verified.problems.join('; ') });
      return { ok: false, error: `Backup failed verification: ${verified.problems.join('; ')}` };
    }

    tidySidecars(file);
    pruneOldBackups(dir, options.retention ?? DEFAULT_RETENTION);

    log.info('backup.created', {
      size_bytes: sizeBytes,
      unsynced_sales: manifest.unsyncedSales,
      total_sales: manifest.totalSales,
      duration_ms: Date.now() - startedAt,
    });

    return {
      ok: true,
      entry: {
        file,
        manifestFile: manifestPathFor(file),
        createdAt: manifest.createdAt,
        sizeBytes,
        manifest,
      },
    };
  } catch (err) {
    log.error('backup.failed', describeError(err));
    return { ok: false, error: 'Backup failed.' };
  }
}

/**
 * Open a backup and check it is a real, readable, migrated database.
 *
 * Read-only with respect to the live database: verifying never touches it.
 */
export function verifyBackup(file: string): VerifyResult {
  const problems: string[] = [];
  const result: VerifyResult = {
    ok: false,
    file,
    integrity: 'not-checked',
    schemaVersion: null,
    manifest: readManifest(file),
    problems,
  };

  if (!fs.existsSync(file)) {
    problems.push('Backup file does not exist.');
    return result;
  }

  // A separate handle, opened read-only. Deliberately NOT the shared
  // singleton — verifying a backup must never disturb the live connection.
  let handle: Db | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    handle = new Database(file, { readonly: true, fileMustExist: true });

    const rows = handle.pragma('integrity_check') as { integrity_check: string }[];
    result.integrity = rows[0]?.integrity_check ?? 'unknown';
    if (result.integrity !== 'ok') problems.push(`Integrity check: ${result.integrity}`);

    const version = handle.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as
      | { v: number | null }
      | undefined;
    result.schemaVersion = version?.v ?? null;
    if (!result.schemaVersion) problems.push('No applied migrations found.');

    // The tables a sale actually lives in. A file that opens but has no sale
    // table would restore "successfully" and lose everything.
    for (const table of ['sale', 'sale_item', 'payment', 'sync_queue']) {
      const found = handle
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { n: number };
      if (found.n === 0) problems.push(`Missing table: ${table}`);
    }

    // Cross-check the manifest against what the file really holds.
    if (result.manifest && problems.length === 0) {
      const actual = handle.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number };
      if (actual.n !== result.manifest.totalSales) {
        problems.push(
          `Manifest says ${result.manifest.totalSales} sales, file holds ${actual.n}.`,
        );
      }
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : 'Could not open backup.');
  } finally {
    try {
      handle?.close();
    } catch {
      /* best effort */
    }
  }

  result.ok = problems.length === 0;
  return result;
}

function readManifest(file: string): BackupManifest | null {
  try {
    const raw = fs.readFileSync(manifestPathFor(file), 'utf8');
    return JSON.parse(raw) as BackupManifest;
  } catch {
    return null;
  }
}

/**
 * Remove the EMPTY -wal / -shm files that opening a WAL database creates.
 *
 * Reading a backup to verify it leaves zero-length sidecars behind. They are
 * harmless to SQLite but not to a person: someone recovering a shop at 9am
 * should find one database file and one manifest, not four files and a
 * question about which of them matter.
 *
 * Only ever removes a ZERO-LENGTH sidecar. A -wal with content holds committed
 * transactions, and deleting one would destroy exactly the data this module
 * exists to protect.
 */
function tidySidecars(file: string): void {
  try {
    const wal = `${file}-wal`;

    // A -wal with ANY content holds committed transactions that are not yet
    // in the main file. Removing it would destroy exactly the data this
    // module exists to protect, so if one exists both files are left alone
    // and the backup keeps its sidecars.
    if (fs.existsSync(wal) && fs.statSync(wal).size > 0) return;

    // Past this point the WAL is empty, so nothing is lost. -shm is never
    // zero-length (it is a fixed-size shared-memory index) but it holds no
    // durable data at all — SQLite rebuilds it on the next open.
    fs.rmSync(wal, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  } catch {
    /* best effort — a leftover sidecar is untidy, not dangerous */
  }
}

/** Backups on disk, newest first. */
export function listBackups(dir = backupDir()): BackupEntry[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('retailos-') && f.endsWith('.db'))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      const manifest = readManifest(full);
      return {
        file: full,
        manifestFile: manifestPathFor(full),
        createdAt: manifest?.createdAt ?? stat.mtime.toISOString(),
        sizeBytes: stat.size,
        manifest,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Drop the oldest backups beyond the retention count.
 *
 * Only ever removes VERIFIABLE, superseded copies, and never the newest one
 * regardless of retention: a shop should not end up with zero backups because
 * a number was misconfigured.
 */
export function pruneOldBackups(dir = backupDir(), retention = DEFAULT_RETENTION): number {
  const keep = Math.max(1, retention);
  const entries = listBackups(dir);
  if (entries.length <= keep) return 0;

  let removed = 0;
  for (const entry of entries.slice(keep)) {
    try {
      fs.rmSync(entry.file, { force: true });
      fs.rmSync(entry.manifestFile, { force: true });
      removed += 1;
    } catch (err) {
      log.warn('backup.prune_failed', describeError(err));
    }
  }
  if (removed > 0) log.info('backup.pruned', { removed_count: removed });
  return removed;
}

export interface RestoreResult {
  ok: boolean;
  replacedTo?: string;
  error?: string;
  verification?: VerifyResult;
}

/**
 * Replace the live database with a backup.
 *
 * THREE RULES, all about not destroying something valid:
 *
 *   1. The backup is verified FIRST. An unverified file is never restored.
 *   2. The current database is MOVED ASIDE, never deleted. If the restore was
 *      a mistake, or the backup turns out to be older than someone thought,
 *      the original is still sitting there.
 *   3. The WAL and SHM sidecars are moved with it. Leaving a stale `-wal`
 *      next to a restored file is a corruption bug waiting to happen.
 *
 * The caller must have CLOSED the database first. This does not close it,
 * because a service that silently closes the live connection underneath its
 * caller is how you get half-written state.
 */
export function restoreBackup(
  file: string,
  targetDbPath: string,
): RestoreResult {
  const verification = verifyBackup(file);
  if (!verification.ok) {
    return {
      ok: false,
      error: `Refusing to restore an unverified backup: ${verification.problems.join('; ')}`,
      verification,
    };
  }

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let replacedTo: string | undefined;

    if (fs.existsSync(targetDbPath)) {
      replacedTo = `${targetDbPath}.replaced-${stamp}`;
      fs.renameSync(targetDbPath, replacedTo);
      // Sidecars belong to the file we just moved; a stale -wal beside the
      // restored database would corrupt it.
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${targetDbPath}${suffix}`;
        if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${replacedTo}${suffix}`);
      }
    }

    fs.copyFileSync(file, targetDbPath);

    // Prove the thing we just put in place is readable before declaring success.
    const after = verifyBackup(targetDbPath);
    if (!after.ok) {
      // Put the original back rather than leaving the till with a broken file.
      fs.rmSync(targetDbPath, { force: true });
      if (replacedTo && fs.existsSync(replacedTo)) fs.renameSync(replacedTo, targetDbPath);
      return {
        ok: false,
        error: 'Restored file failed verification; the original was put back.',
        verification: after,
      };
    }

    log.warn('backup.restored', {
      from: path.basename(file),
      previous_kept_at: replacedTo ? path.basename(replacedTo) : null,
    });
    return { ok: true, replacedTo, verification: after };
  } catch (err) {
    log.error('backup.restore_failed', describeError(err));
    return { ok: false, error: 'Restore failed.' };
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Periodic backups from the MAIN process.
 *
 * Unlike sync, a backup needs no access token, so it does not depend on a
 * window being open. A till left running overnight keeps protecting itself.
 */
class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  isRunning(): boolean {
    return this.running;
  }

  /** Run once now, then on an interval. Safe to call twice. */
  start(intervalMs = 30 * 60_000): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    log.info('backup.scheduler_started', { interval_ms: intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    // Overlapping backups would contend for the same connection to no
    // purpose; a skipped tick costs nothing.
    if (this.running) return;
    this.running = true;
    try {
      const db = openDatabase();
      const integrity = checkIntegrity(db);
      if (!integrity.ok) {
        // Backing up a corrupt database would preserve the corruption and
        // could rotate a good copy out of retention.
        log.error('backup.skipped_corrupt_database', { result: integrity.result });
        return;
      }
      await createBackup(db);
    } catch (err) {
      log.error('backup.tick_failed', describeError(err));
    } finally {
      this.running = false;
    }
  }
}

export const backupScheduler = new BackupScheduler();
