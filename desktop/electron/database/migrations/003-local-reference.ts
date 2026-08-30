/**
 * Migration 003 — offline bill reference.
 *
 * WHY THIS IS SEPARATE FROM invoice_number
 * ----------------------------------------
 * The backend owns invoice numbering: `sale_number_sequences` allocates a
 * sequence per (store_id, year_month) and `sales.number` carries a UNIQUE
 * constraint. A terminal that is offline cannot participate in that
 * allocation — two terminals would both take "the next number" and collide
 * the moment they sync.
 *
 * So an offline bill gets a LOCAL REFERENCE instead. It is deliberately
 * formatted so nobody can mistake it for a GST invoice number:
 *
 *     OFFLINE-<terminal>-<000001>
 *
 * When the sale eventually syncs, the server assigns the real
 * `invoice_number` and both are kept — the local reference stays as the
 * printed-receipt trace, the server number becomes the tax document.
 *
 * Uniqueness guarantees:
 *   - within a terminal: monotonic counter in `local_sequence`, incremented
 *     inside the same transaction as the sale, so a crash cannot reuse one
 *   - across terminals: the <terminal> segment is derived from the device
 *     UUID, which is generated once per install and never regenerated
 *   - across restarts/power loss: the counter is a committed SQLite row,
 *     not an in-memory variable
 */

import type { Migration } from './types';

export const migration003: Migration = {
  version: 3,
  name: 'local-reference',
  up: (db) => {
    db.exec(`
      -- Human-readable, printable reference for a locally-created sale.
      -- Nullable: a sale created while online may never need one.
      ALTER TABLE sale ADD COLUMN local_reference TEXT;

      -- Partial unique: enforces no duplicate reference without rejecting the
      -- many rows that legitimately have none.
      CREATE UNIQUE INDEX idx_sale_local_ref
        ON sale(local_reference) WHERE local_reference IS NOT NULL;

      -- Named monotonic counters. One row per sequence so the same mechanism
      -- can later serve returns or other document types without a schema change.
      CREATE TABLE local_sequence (
        name       TEXT PRIMARY KEY,
        value      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      INSERT INTO local_sequence (name, value, updated_at)
      VALUES ('sale', 0, datetime('now'));
    `);
  },
};
