/**
 * Migration 007 — capture the sale's own attribution at the counter.
 *
 * THE INVARIANT THIS EXISTS TO PROTECT
 * ------------------------------------
 *     SALE-TIME SESSION -> SQLite snapshot -> payload -> PostgreSQL
 *
 * A bill rung up at 21:40 belongs to the shift that was open at 21:40. Before
 * this migration the local sale recorded nothing about the session, so the
 * server had no choice but to attach it to whatever session happened to be
 * open when the terminal reconnected. An overnight outage therefore moved last
 * night's takings into today's shift and corrupted the cash reconciliation of
 * both: yesterday's close was computed without the sale, and today's expected
 * cash was inflated by money the till never received today.
 *
 * The session is captured HERE, at commit time, and never resolved later.
 * Resolution at sync time is the bug, not the fix.
 *
 * WHAT EACH COLUMN IS FOR
 * -----------------------
 * server_day_session_id  The server's day_session uuid, as known when the sale
 *                        was rung up. No foreign key: it names a row in
 *                        PostgreSQL, not in this database.
 *
 * occurred_at            When the sale actually happened. `created_at` already
 *                        records the row's insert time and they are usually
 *                        identical, but they are different facts: created_at is
 *                        when the row was written, occurred_at is when money
 *                        changed hands. The server uses this for the invoice
 *                        MONTH, so a 31 March bill synced on 1 April keeps a
 *                        March invoice number.
 *
 * terminal_uuid          The device_uuid of the till. `sale.terminal_id` is a
 *                        local foreign key into the `terminal` table and is not
 *                        the same thing: it is a local row id, it is currently
 *                        never populated, and it cannot travel to a server that
 *                        has no terminal registry. This column carries the
 *                        durable device identity instead.
 *
 * Additive and idempotent. Existing sales keep NULLs and remain fully
 * readable, printable and syncable.
 */

import type { Migration } from './types';

export const migration007: Migration = {
  version: 7,
  name: 'session-attribution',
  up: (db) => {
    db.exec(`
      -- Server day_session uuid, recorded at the moment of sale.
      ALTER TABLE sale ADD COLUMN server_day_session_id TEXT;

      -- True occurrence time, distinct from the row's created_at.
      ALTER TABLE sale ADD COLUMN occurred_at TEXT;

      -- Device identity of the till (device.device_uuid).
      ALTER TABLE sale ADD COLUMN terminal_uuid TEXT;

      -- Reconciliation reads sales per till and per shift.
      CREATE INDEX idx_sale_terminal_uuid ON sale(terminal_uuid);
      CREATE INDEX idx_sale_server_day_session ON sale(server_day_session_id);
    `);
  },
};
