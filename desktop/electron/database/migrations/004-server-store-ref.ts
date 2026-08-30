/**
 * Migration 004 — record the SERVER store id on a sale.
 *
 * WHY
 * ---
 * `sale.store_id` carries a foreign key to the local `store` table. But the
 * cart holds a SERVER store uuid, and the local `store` table is empty until
 * stores are synced (Phase 5). Passing the server id into a FK column fails
 * with "FOREIGN KEY constraint failed" the moment a real bill is committed.
 *
 * Rather than drop the FK — which would lose a genuine integrity guarantee
 * once stores ARE synced — a separate non-FK column records the server's
 * identifier. Same pattern already used for `server_id` on product and
 * variant: local identity and server identity are different things and get
 * different columns.
 *
 * A new migration rather than an edit to 003: 003 may already have been
 * applied to a developer database, and editing an applied migration is how
 * schemas silently diverge between machines.
 */

import type { Migration } from './types';

export const migration004: Migration = {
  version: 4,
  name: 'server-store-ref',
  up: (db) => {
    db.exec(`
      -- Server store uuid. No FK: the local store row may not exist yet.
      ALTER TABLE sale ADD COLUMN server_store_id TEXT;

      -- Server customer uuid, same reasoning — a walk-in customer created on
      -- the server will not be in the local customer table on day one.
      ALTER TABLE sale ADD COLUMN server_customer_id TEXT;

      -- Reporting reads sales by store far more often than by anything else.
      CREATE INDEX idx_sale_server_store ON sale(server_store_id);
    `);
  },
};
