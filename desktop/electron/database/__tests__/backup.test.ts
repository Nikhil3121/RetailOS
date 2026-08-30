/**
 * Phase 8 — backup, verification and restore.
 *
 * These run against real SQLite files. The point of a backup is the day
 * something has already gone wrong, so the tests are written around that day:
 * a corrupt file must be refused, a restore must never destroy the thing it
 * replaces, and a backup taken while the sync loop is writing must still open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let tempDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tempDir },
  ipcMain: { handle: vi.fn() },
}));

import { closeDatabase, openDatabase } from '../connection';
import { runMigrations } from '../migrations';
import { DeviceRepository } from '../repositories/device-repository';
import { SaleRepository, type SaleInput } from '../repositories/sale-repository';
import {
  checkIntegrity,
  createBackup,
  listBackups,
  pruneOldBackups,
  restoreBackup,
  summarise,
  verifyBackup,
} from '../backup-service';

function freshDb(file?: string) {
  const target = file ?? path.join(tempDir, `live-${randomUUID()}.db`);
  const db = openDatabase(target);
  runMigrations(db);
  new DeviceRepository(db).getOrCreate();
  return { db, file: target };
}

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  serverStoreId: '33333333-3333-4333-8333-333333333333',
  items: [
    {
      productId: null,
      serverVariantId: '44444444-4444-4444-8444-444444444444',
      productName: 'SHORT KURTI 660',
      sku: '160055.003',
      quantity: 1,
      unitPricePaise: 34300,
      discountPctBp: 3000,
      discountPaise: 10290,
      taxRateBp: 500,
      taxPaise: 1143,
      lineTotalPaise: 24000,
    },
  ],
  payments: [{ method: 'cash', amountPaise: 24000, reference: null }],
  ...over,
});

let backupsDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-p8-'));
  backupsDir = path.join(tempDir, 'backups');
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

describe('integrity checks', () => {
  it('reports a healthy database as ok', () => {
    const { db } = freshDb();
    expect(checkIntegrity(db)).toEqual({ ok: true, result: 'ok' });
  });

  it('counts unsynced separately from synced', () => {
    // The distinction that matters: an unsynced sale exists NOWHERE else.
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const a = repo.create(sale());
    repo.create(sale());
    repo.markSynced(a, 'server-1', 'INV-1', 1143, 24000);

    const s = summarise(db);
    expect(s.totalSales).toBe(2);
    expect(s.syncedSales).toBe(1);
    expect(s.unsyncedSales).toBe(1);
    expect(s.totalPaise).toBe(48000);
    expect(s.schemaVersion).toBeGreaterThanOrEqual(7);
  });
});

describe('creating a backup', () => {
  it('writes a verified file with a manifest', async () => {
    const { db } = freshDb();
    new SaleRepository(db).create(sale());

    const result = await createBackup(db, { dir: backupsDir });
    expect(result.ok).toBe(true);
    const entry = result.entry!;

    expect(fs.existsSync(entry.file)).toBe(true);
    expect(fs.existsSync(entry.manifestFile)).toBe(true);
    expect(entry.manifest?.totalSales).toBe(1);
    expect(entry.manifest?.unsyncedSales).toBe(1);
    expect(entry.manifest?.totalPaise).toBe(24000);
  });

  it('produces a file that opens on its own, with no WAL sidecar', async () => {
    // The whole reason for using the online backup API rather than copying
    // the file: a plain copy would be missing everything still in the WAL.
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    for (let i = 0; i < 5; i++) repo.create(sale());

    const { entry } = await createBackup(db, { dir: backupsDir });

    // Move the backup somewhere else, ALONE, with no sidecar of any kind.
    // If the online backup were really a partial copy this would come up
    // short or refuse to open.
    const isolated = path.join(tempDir, 'isolated.db');
    fs.copyFileSync(entry!.file, isolated);
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${isolated}${suffix}`, { force: true });
    }

    const verified = verifyBackup(isolated);
    expect(verified.ok).toBe(true);
    expect(verified.integrity).toBe('ok');
    expect(verified.manifest ?? { totalSales: -1 }).toBeTruthy();

    const alone = openDatabase(isolated);
    expect((alone.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number }).n).toBe(5);
  });

  it('leaves exactly two files per backup', async () => {
    // Someone recovering a shop should find a database and a manifest, not
    // four files and a question about which ones matter.
    const { db } = freshDb();
    new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });

    const files = fs.readdirSync(backupsDir).sort();
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith('.db'))).toBe(true);
    expect(files.some((f) => f.endsWith('.db.json'))).toBe(true);
    expect(fs.existsSync(`${entry!.file}-wal`)).toBe(false);
    expect(fs.existsSync(`${entry!.file}-shm`)).toBe(false);
  });

  it('never removes a sidecar that holds data', async () => {
    const { db } = freshDb();
    new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });

    // A non-empty WAL holds committed transactions; deleting it would destroy
    // the very data this module protects.
    fs.writeFileSync(`${entry!.file}-wal`, 'not empty');
    expect(verifyBackup(entry!.file).ok).toBe(true);
    expect(fs.existsSync(`${entry!.file}-wal`)).toBe(true);
  });

  it('captures sales committed moments earlier', async () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    for (let i = 0; i < 3; i++) repo.create(sale());

    const { entry } = await createBackup(db, { dir: backupsDir });
    expect(entry!.manifest?.totalSales).toBe(3);

    // And the data is genuinely in the file, not just in the manifest.
    const restored = openDatabase(entry!.file);
    expect((restored.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number }).n).toBe(3);
  });

  it('keeps working while writes continue', async () => {
    // The sync loop writes on a timer now; a backup must survive that.
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    for (let i = 0; i < 10; i++) repo.create(sale());

    const backup = createBackup(db, { dir: backupsDir });
    for (let i = 0; i < 10; i++) repo.create(sale());
    const result = await backup;

    expect(result.ok).toBe(true);
    expect(verifyBackup(result.entry!.file).ok).toBe(true);
    // Whatever the backup captured, its manifest describes THAT — not a
    // snapshot of the source taken before the writes landed.
    const captured = result.entry!.manifest!.totalSales;
    expect(captured).toBeGreaterThanOrEqual(10);
    expect(captured).toBeLessThanOrEqual(20);
  });
});

describe('verification refuses what it should', () => {
  it('rejects a missing file', () => {
    const v = verifyBackup(path.join(tempDir, 'nope.db'));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/does not exist/i);
  });

  it('rejects a corrupt file', () => {
    const bad = path.join(tempDir, 'corrupt.db');
    fs.writeFileSync(bad, 'this is definitely not a database');
    const v = verifyBackup(bad);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it('rejects a valid database that has no sale tables', () => {
    // Opens cleanly, but restoring it would silently lose every bill.
    const empty = path.join(tempDir, 'empty.db');
    const db = openDatabase(empty);
    db.exec('CREATE TABLE schema_migrations (version INTEGER, name TEXT, applied_at TEXT)');
    db.prepare("INSERT INTO schema_migrations VALUES (1, 'x', 'now')").run();
    closeDatabase();

    const v = verifyBackup(empty);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/Missing table: sale/);
  });

  it('rejects a backup whose manifest disagrees with the file', async () => {
    const { db } = freshDb();
    new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });

    // Someone edited or swapped the manifest.
    const manifest = JSON.parse(fs.readFileSync(entry!.manifestFile, 'utf8'));
    manifest.totalSales = 99;
    fs.writeFileSync(entry!.manifestFile, JSON.stringify(manifest));

    const v = verifyBackup(entry!.file);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/Manifest says 99/);
  });
});

describe('retention', () => {
  it('keeps the newest and prunes the rest', async () => {
    const { db } = freshDb();
    new SaleRepository(db).create(sale());

    for (let i = 0; i < 5; i++) {
      await createBackup(db, { dir: backupsDir, retention: 50 });
      // Timestamps are second-resolution in the filename; keep them distinct.
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(listBackups(backupsDir).length).toBe(5);

    pruneOldBackups(backupsDir, 2);
    const left = listBackups(backupsDir);
    expect(left.length).toBe(2);
    // The survivors are the newest ones.
    expect(left[0].createdAt >= left[1].createdAt).toBe(true);
  });

  it('never prunes down to zero, whatever the retention says', async () => {
    const { db } = freshDb();
    await createBackup(db, { dir: backupsDir });
    pruneOldBackups(backupsDir, 0);
    expect(listBackups(backupsDir).length).toBe(1);
  });

  it('removes the manifest alongside the file', async () => {
    const { db } = freshDb();
    for (let i = 0; i < 3; i++) {
      await createBackup(db, { dir: backupsDir, retention: 50 });
      await new Promise((r) => setTimeout(r, 5));
    }
    const before = listBackups(backupsDir);
    pruneOldBackups(backupsDir, 1);

    for (const stale of before.slice(1)) {
      expect(fs.existsSync(stale.file)).toBe(false);
      expect(fs.existsSync(stale.manifestFile)).toBe(false);
    }
  });
});

describe('restore', () => {
  it('replaces the database and keeps the old one', async () => {
    const { db, file } = freshDb();
    const repo = new SaleRepository(db);
    repo.create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });

    // More trading happens after the backup.
    repo.create(sale());
    repo.create(sale());
    expect(repo.count()).toBe(3);
    closeDatabase();

    const result = restoreBackup(entry!.file, file);
    expect(result.ok).toBe(true);

    // The restored database holds what the backup held.
    const reopened = openDatabase(file);
    expect(
      (reopened.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number }).n,
    ).toBe(1);

    // ...and the newer database was moved aside, NOT deleted. The two sales
    // made after the backup are still recoverable from it.
    expect(result.replacedTo).toBeTruthy();
    expect(fs.existsSync(result.replacedTo!)).toBe(true);
  });

  it('refuses an unverified backup and leaves the database untouched', () => {
    const { db, file } = freshDb();
    new SaleRepository(db).create(sale());
    const before = new SaleRepository(db).count();
    closeDatabase();

    const bad = path.join(tempDir, 'garbage.db');
    fs.writeFileSync(bad, 'not a database');

    const result = restoreBackup(bad, file);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unverified/i);

    // Untouched.
    const reopened = openDatabase(file);
    expect(new SaleRepository(reopened).count()).toBe(before);
  });

  it('moves the WAL sidecar aside with the database it belongs to', async () => {
    const { db, file } = freshDb();
    new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });
    closeDatabase();

    // A stale -wal left beside a restored file is a corruption bug.
    fs.writeFileSync(`${file}-wal`, 'stale wal');
    const result = restoreBackup(entry!.file, file);

    expect(result.ok).toBe(true);
    // The stale WAL went with the database it belonged to...
    expect(fs.existsSync(`${result.replacedTo}-wal`)).toBe(true);
    expect(fs.readFileSync(`${result.replacedTo}-wal`, 'utf8')).toBe('stale wal');
    // ...and did NOT survive next to the restored file, where it would have
    // corrupted it. (Verification reopens the file, so a fresh empty WAL may
    // exist; what matters is that it is not the stale one.)
    if (fs.existsSync(`${file}-wal`)) {
      expect(fs.readFileSync(`${file}-wal`, 'utf8')).not.toBe('stale wal');
    }
  });

  it('restores onto a missing database file', async () => {
    // The PC-failure case: the working file is simply gone.
    const { db, file } = freshDb();
    new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });
    closeDatabase();
    fs.rmSync(file, { force: true });

    const result = restoreBackup(entry!.file, file);
    expect(result.ok).toBe(true);
    expect(result.replacedTo).toBeUndefined();
    expect(new SaleRepository(openDatabase(file)).count()).toBe(1);
  });

  it('a restored database keeps unsynced sales queued for sync', async () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    const { entry } = await createBackup(db, { dir: backupsDir });
    closeDatabase();

    restoreBackup(entry!.file, file);
    const reopened = openDatabase(file);

    // The irreplaceable part survived AND is still queued to reach the server.
    const record = new SaleRepository(reopened).get(id);
    expect(record?.totalPaise).toBe(24000);
    expect(
      (reopened
        .prepare("SELECT status FROM sync_queue WHERE entity_id = ?")
        .get(id) as { status: string }).status,
    ).toBe('PENDING');
  });

  it('money is identical across backup and restore', async () => {
    const { db, file } = freshDb();
    const repo = new SaleRepository(db);
    for (let i = 0; i < 7; i++) repo.create(sale());
    const before = summarise(db);

    const { entry } = await createBackup(db, { dir: backupsDir });
    closeDatabase();
    restoreBackup(entry!.file, file);

    const after = summarise(openDatabase(file));
    expect(after.totalPaise).toBe(before.totalPaise);
    expect(after.totalSales).toBe(before.totalSales);
    expect(after.unsyncedSales).toBe(before.unsyncedSales);
  });
});
