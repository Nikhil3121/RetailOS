/**
 * Migration 001 — foundation schema.
 *
 * Creates identity, catalog-cache, transaction and sync tables. Nothing here
 * is wired into billing yet; this phase only establishes the shapes.
 *
 * Two conventions run through the whole schema:
 *
 *   1. Locally-created rows use a client-generated UUID as `id`. That is the
 *      INTERNAL transaction identifier and it never changes. `server_id` is a
 *      separate nullable column filled in after a successful sync.
 *
 *   2. `invoice_number` is deliberately NOT the primary key and is nullable.
 *      A customer-facing invoice number is a business artifact with GST rules
 *      attached; conflating it with the row identity would make offline
 *      creation impossible and renumbering catastrophic.
 *
 * Money is stored as INTEGER paise, never REAL. Floating point cannot
 * represent 0.1 exactly, and a POS that is off by a paisa per line is a POS
 * whose day-close never balances.
 */

import type { Migration } from './types';

export const migration001: Migration = {
  version: 1,
  name: 'foundation',
  up: (db) => {
    db.exec(`
      -- ============ IDENTITY ============

      -- Exactly one row, enforced by the CHECK on singleton_guard. Holds this
      -- installation's permanent identity.
      CREATE TABLE device (
        singleton_guard   INTEGER PRIMARY KEY CHECK (singleton_guard = 1),
        device_uuid       TEXT    NOT NULL UNIQUE,
        terminal_code     TEXT,
        terminal_name     TEXT,
        organization_id   TEXT,
        mall_id           TEXT,
        store_id          TEXT,
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE TABLE store (
        id           TEXT PRIMARY KEY,
        server_id    TEXT UNIQUE,
        code         TEXT NOT NULL,
        name         TEXT NOT NULL,
        mall_id      TEXT,
        gstin        TEXT,
        address      TEXT,
        is_active    INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE terminal (
        id             TEXT PRIMARY KEY,
        server_id      TEXT UNIQUE,
        store_id       TEXT REFERENCES store(id) ON DELETE SET NULL,
        terminal_code  TEXT NOT NULL,
        terminal_name  TEXT,
        device_uuid    TEXT,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_terminal_store_code ON terminal(store_id, terminal_code);

      -- ============ CATALOG (server-owned cache) ============

      CREATE TABLE product (
        id           TEXT PRIMARY KEY,
        server_id    TEXT UNIQUE,
        name         TEXT NOT NULL,
        sku          TEXT,
        hsn          TEXT,
        category_id  TEXT,
        brand_id     TEXT,
        unit_id      TEXT,
        is_active    INTEGER NOT NULL DEFAULT 1,
        updated_at   TEXT NOT NULL,
        synced_at    TEXT
      );
      CREATE INDEX idx_product_sku    ON product(sku);
      CREATE INDEX idx_product_name   ON product(name);
      CREATE INDEX idx_product_active ON product(is_active);

      CREATE TABLE product_barcode (
        id         TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        barcode    TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0
      );
      -- Scan lookup is the hottest read path in the whole application.
      CREATE UNIQUE INDEX idx_barcode_value ON product_barcode(barcode);

      CREATE TABLE price (
        id             TEXT PRIMARY KEY,
        product_id     TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        mrp_paise      INTEGER NOT NULL,
        sale_paise     INTEGER NOT NULL,
        effective_from TEXT NOT NULL,
        effective_to   TEXT,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_price_product ON price(product_id, effective_from);

      CREATE TABLE tax_rule (
        id             TEXT PRIMARY KEY,
        server_id      TEXT UNIQUE,
        name           TEXT NOT NULL,
        rate_bp        INTEGER NOT NULL,          -- basis points: 500 = 5.00%
        hsn_prefix     TEXT,
        is_inclusive   INTEGER NOT NULL DEFAULT 1,
        effective_from TEXT NOT NULL,
        effective_to   TEXT,
        updated_at     TEXT NOT NULL
      );

      -- ============ PARTIES ============

      CREATE TABLE customer (
        id          TEXT PRIMARY KEY,
        server_id   TEXT UNIQUE,
        name        TEXT NOT NULL,
        phone       TEXT,
        email       TEXT,
        gstin       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'PENDING'
      );
      CREATE INDEX idx_customer_phone ON customer(phone);

      -- ============ TRANSACTIONS (locally created) ============

      CREATE TABLE sale (
        id              TEXT PRIMARY KEY,          -- internal UUID, immutable
        server_id       TEXT UNIQUE,               -- assigned on sync
        invoice_number  TEXT,                      -- human-facing, assigned later
        terminal_id     TEXT REFERENCES terminal(id) ON DELETE SET NULL,
        store_id        TEXT REFERENCES store(id)  ON DELETE SET NULL,
        customer_id     TEXT REFERENCES customer(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'DRAFT',
        subtotal_paise  INTEGER NOT NULL DEFAULT 0,
        discount_paise  INTEGER NOT NULL DEFAULT 0,
        tax_paise       INTEGER NOT NULL DEFAULT 0,
        total_paise     INTEGER NOT NULL DEFAULT 0,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        sync_status     TEXT NOT NULL DEFAULT 'PENDING'
      );
      CREATE INDEX idx_sale_created ON sale(created_at);
      CREATE INDEX idx_sale_sync    ON sale(sync_status);
      CREATE INDEX idx_sale_invoice ON sale(invoice_number);

      CREATE TABLE sale_item (
        id             TEXT PRIMARY KEY,
        sale_id        TEXT NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
        product_id     TEXT,
        product_name   TEXT NOT NULL,   -- denormalised: the receipt must survive
        sku            TEXT,            -- a later rename or delete of the product
        quantity       REAL NOT NULL,   -- REAL: fabric sells in fractional metres
        unit_price_paise INTEGER NOT NULL,
        discount_paise INTEGER NOT NULL DEFAULT 0,
        tax_rate_bp    INTEGER NOT NULL DEFAULT 0,
        tax_paise      INTEGER NOT NULL DEFAULT 0,
        line_total_paise INTEGER NOT NULL,
        line_no        INTEGER NOT NULL
      );
      CREATE INDEX idx_sale_item_sale ON sale_item(sale_id);

      CREATE TABLE payment (
        id          TEXT PRIMARY KEY,
        sale_id     TEXT NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
        method      TEXT NOT NULL,      -- cash | card | upi | credit
        amount_paise INTEGER NOT NULL,
        reference   TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_payment_sale ON payment(sale_id);

      CREATE TABLE held_bill (
        id          TEXT PRIMARY KEY,
        terminal_id TEXT,
        store_id    TEXT,
        payload     TEXT NOT NULL,      -- JSON cart snapshot
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- ============ SYNC ============

      CREATE TABLE sync_queue (
        id              TEXT PRIMARY KEY,
        entity_type     TEXT NOT NULL,
        entity_id       TEXT NOT NULL,
        operation       TEXT NOT NULL CHECK (operation IN ('CREATE','UPDATE','DELETE')),
        payload         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        attempt_count   INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        next_attempt_at TEXT,
        status          TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','FAILED','SYNCED')),
        error           TEXT
      );
      -- The drain query is "pending work that is due" — this index serves it.
      CREATE INDEX idx_sync_queue_ready  ON sync_queue(status, next_attempt_at);
      CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);

      CREATE TABLE sync_state (
        entity              TEXT PRIMARY KEY,
        last_server_cursor  TEXT,
        last_successful_sync TEXT,
        sync_status         TEXT NOT NULL DEFAULT 'IDLE',
        updated_at          TEXT NOT NULL
      );
    `);
  },
};
