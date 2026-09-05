/**
 * Migration runner.
 *
 * Guarantees:
 *   - Ordered. Migrations run in ascending `version`.
 *   - Tracked. Applied versions are recorded in `schema_migrations`.
 *   - Idempotent. A second run applies nothing.
 *   - Atomic per migration. Each runs in its own transaction; a throw rolls
 *     that migration back and leaves the database on the previous version.
 *   - Non-destructive. There is no down-migration and nothing here drops a
 *     table it did not just create.
 *
 * On failure the runner rethrows. The caller decides what to do — it must NOT
 * silently continue, because an app running against a half-migrated schema
 * will corrupt data in ways that are very hard to unpick later.
 */

import type { Db } from '../connection';
import { describeError, log } from '../logger';
import { migration001 } from './001-foundation';
import { migration002 } from './002-catalog';
import { migration003 } from './003-local-reference';
import { migration004 } from './004-server-store-ref';
import { migration005 } from './005-sync-payload';
import { migration006 } from './006-sync-outcome';
import { migration007 } from './007-session-attribution';
import { migration008 } from './008-store-receipt';
import type { Migration } from './types';

export type { Migration } from './types';

/** Every known migration. Append here; never renumber or edit a shipped one. */
export const MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];

function ensureTrackingTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedVersions(db: Db): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

/** Reject duplicate versions before touching the database — a duplicate almost
 *  always means two branches added a migration with the same number. */
function assertUniqueVersions(migrations: Migration[]): void {
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version} (${m.name}).`);
    }
    seen.add(m.version);
  }
}

export interface MigrationResult {
  applied: number[];
  skipped: number[];
  currentVersion: number;
}

export function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): MigrationResult {
  assertUniqueVersions(migrations);
  ensureTrackingTable(db);

  const already = appliedVersions(db);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  const applied: number[] = [];
  const skipped: number[] = [];

  for (const migration of ordered) {
    if (already.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }

    // better-sqlite3's transaction() wrapper rolls back automatically if the
    // callback throws, so a failed migration leaves no partial schema behind.
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, new Date().toISOString());
    });

    try {
      run();
      applied.push(migration.version);
      log.info('migration.applied', { version: migration.version, name: migration.name });
    } catch (err) {
      log.error('migration.failed', {
        version: migration.version,
        name: migration.name,
        ...describeError(err),
      });
      // Rethrow — the caller must not proceed on a half-migrated schema.
      throw err;
    }
  }

  const currentVersion = ordered.length ? Math.max(...ordered.map((m) => m.version)) : 0;
  log.info('migration.complete', {
    applied_count: applied.length,
    skipped_count: skipped.length,
    current_version: currentVersion,
  });

  return { applied, skipped, currentVersion };
}

/** Highest applied version, or 0 on a fresh database. */
export function currentSchemaVersion(db: Db): number {
  ensureTrackingTable(db);
  const row = db
    .prepare('SELECT MAX(version) AS v FROM schema_migrations')
    .get() as { v: number | null };
  return row?.v ?? 0;
}
