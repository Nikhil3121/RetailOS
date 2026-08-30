/**
 * Migration 002 — local catalog, aligned to the actual FastAPI contract.
 *
 * Phase 1 modelled sku/price on `product`. The real backend puts them on the
 * VARIANT: a product carries name, hsn_code and tax_rate; each variant carries
 * sku, barcode, mrp, selling_price and cost_price. This migration adds
 * `product_variant` and moves catalog identity onto it.
 *
 * Phase 1's `product_barcode` and `price` tables are LEFT IN PLACE and unused
 * by the catalog path. Dropping them would be destructive for no benefit, and
 * migration 001 has already shipped in the working tree.
 *
 * Server identity is preserved everywhere: `server_product_id` and
 * `server_variant_id` are the backend UUIDs, so every local row maps back.
 */

import type { Migration } from './types';

export const migration002: Migration = {
  version: 2,
  name: 'catalog',
  up: (db) => {
    db.exec(`
      -- Product-level tax. The backend exposes tax_rate on the PRODUCT
      -- (a Decimal percentage); stored here as basis points to stay integer.
      ALTER TABLE product ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE product ADD COLUMN description TEXT;

      CREATE TABLE product_variant (
        id                   TEXT PRIMARY KEY,        -- local UUID
        server_variant_id    TEXT NOT NULL UNIQUE,    -- backend variant UUID
        product_id           TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        server_product_id    TEXT NOT NULL,
        name                 TEXT NOT NULL,
        sku                  TEXT NOT NULL,
        barcode              TEXT,
        attributes           TEXT,                    -- JSON blob from server
        mrp_paise            INTEGER NOT NULL DEFAULT 0,
        selling_price_paise  INTEGER NOT NULL DEFAULT 0,
        cost_price_paise     INTEGER NOT NULL DEFAULT 0,
        sort_order           INTEGER NOT NULL DEFAULT 0,
        is_active            INTEGER NOT NULL DEFAULT 1,
        updated_at           TEXT NOT NULL,
        synced_at            TEXT NOT NULL
      );

      -- ---- INDEXES (each justified) ----

      -- THE hot path. A scan must resolve in one index seek regardless of
      -- catalog size. PARTIAL (WHERE barcode IS NOT NULL) for two reasons:
      -- the backend allows barcode to be NULL, and a plain UNIQUE index would
      -- otherwise reject only one NULL in some engines while bloating the
      -- index with rows that can never be scanned.
      CREATE UNIQUE INDEX idx_variant_barcode
        ON product_variant(barcode) WHERE barcode IS NOT NULL;

      -- SKU fallback when a barcode is absent or unreadable. Not unique —
      -- the backend does not guarantee SKU uniqueness across products.
      CREATE INDEX idx_variant_sku ON product_variant(sku);

      -- Sync writes match on server identity; without this, upserting 9,000
      -- variants degrades to a full scan per row.
      CREATE UNIQUE INDEX idx_variant_server ON product_variant(server_variant_id);

      -- Join from a product to its variants when rendering the picker.
      CREATE INDEX idx_variant_product ON product_variant(product_id);

      -- Every catalog read filters is_active = 1. Low cardinality, but the
      -- filter is applied on nearly every query, so it earns its place.
      CREATE INDEX idx_variant_active ON product_variant(is_active);

      -- Product-side server lookup, same reason as the variant one.
      CREATE UNIQUE INDEX idx_product_server ON product(server_id)
        WHERE server_id IS NOT NULL;

      -- ---- CATALOG STATE ----

      -- Single row describing the local catalog's health. Separate from
      -- sync_state (which is per-entity and cursor-oriented) because the POS
      -- needs one unambiguous answer to "can I bill offline right now?".
      CREATE TABLE catalog_sync (
        singleton_guard      INTEGER PRIMARY KEY CHECK (singleton_guard = 1),
        status               TEXT NOT NULL DEFAULT 'NOT_INITIALIZED'
                             CHECK (status IN ('NOT_INITIALIZED','SYNCING','READY','FAILED')),
        last_successful_sync TEXT,
        last_attempt_at      TEXT,
        snapshot_version     TEXT,   -- see note in catalog-sync-service
        product_count        INTEGER NOT NULL DEFAULT 0,
        variant_count        INTEGER NOT NULL DEFAULT 0,
        store_id             TEXT,
        error                TEXT,
        updated_at           TEXT NOT NULL
      );

      INSERT INTO catalog_sync (singleton_guard, status, updated_at)
      VALUES (1, 'NOT_INITIALIZED', datetime('now'));

      -- Malformed server records are quarantined here rather than silently
      -- dropped, so a bad row is diagnosable without replaying the whole sync.
      CREATE TABLE catalog_reject (
        id                TEXT PRIMARY KEY,
        server_product_id TEXT,
        server_variant_id TEXT,
        reason            TEXT NOT NULL,
        raw               TEXT,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX idx_reject_created ON catalog_reject(created_at);
    `);
  },
};
