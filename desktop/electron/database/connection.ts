/**
 * SQLite connection management.
 *
 * The database file lives in Electron's per-user application data directory
 * (`app.getPath('userData')`), NOT next to the executable — a portable install
 * or a Program Files install would otherwise be unwritable or shared between
 * Windows accounts.
 *
 * Pragmas are set on every open, not just on create: they are connection-level
 * settings in SQLite, so a database created with WAL still needs the other
 * pragmas re-applied each time it is reopened.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { describeError, log } from './logger';

export type Db = Database.Database;

let connection: Db | null = null;

/** Absolute path to the SQLite file. Exposed so tests can assert on it. */
export function databasePath(): string {
  return path.join(app.getPath('userData'), 'retailos.db');
}

/**
 * Open (or create) the database and apply connection pragmas.
 *
 * Idempotent — repeated calls return the same handle. `better-sqlite3` is
 * synchronous by design, which suits the main process: every call is short,
 * and it removes a whole class of interleaving bugs that an async driver
 * would introduce into the migration runner.
 */
export function openDatabase(filePath = databasePath()): Db {
  if (connection) return connection;

  // Belt and braces — userData normally exists, but a first run on a fresh
  // Windows profile has been observed to race the directory's creation.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new Database(filePath);

  // WAL: readers never block the writer. On a POS this matters the moment a
  // background sync worker reads while the cashier is saving a bill.
  db.pragma('journal_mode = WAL');
  // NORMAL is the standard WAL pairing: durable across app crashes, and only
  // at risk from an OS-level crash or power cut mid-write.
  db.pragma('synchronous = NORMAL');
  // Off by default in SQLite. Without this, our REFERENCES clauses are inert.
  db.pragma('foreign_keys = ON');
  // Fail fast rather than hanging the UI if another process holds a lock.
  db.pragma('busy_timeout = 5000');

  connection = db;
  log.info('database.opened', {
    path: filePath,
    journal_mode: db.pragma('journal_mode', { simple: true }),
  });
  return db;
}

/** Current handle, or null if `openDatabase` has not run. */
export function getDatabase(): Db | null {
  return connection;
}

/**
 * Handle for callers that cannot proceed without one. Throws rather than
 * returning null so an IPC handler fails loudly instead of silently
 * returning empty data to the renderer.
 */
export function requireDatabase(): Db {
  if (!connection) throw new Error('Database is not initialised.');
  return connection;
}

/** Close the handle. Safe to call when already closed. */
export function closeDatabase(): void {
  if (!connection) return;
  try {
    connection.close();
    log.info('database.closed');
  } catch (err) {
    log.error('database.close_failed', describeError(err));
  } finally {
    connection = null;
  }
}
