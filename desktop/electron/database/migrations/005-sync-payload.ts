/**
 * Migration 005 — preserve everything a future sync needs, and everything a
 * GST receipt must be able to reprint years later.
 *
 * WHY
 * ---
 * Two separate problems, one migration.
 *
 * 1. SYNC IS IMPOSSIBLE WITHOUT server_variant_id.
 *    `POST /api/v1/sales` requires `lines[].variant_id`. The cart HAS that
 *    value at checkout — it is the server variant uuid in both the online
 *    picker path and the local catalog path — but nothing persisted it:
 *    `sale_item.product_id` is a LOCAL foreign key, so checkout deliberately
 *    writes null there. The identifier was reaching the boundary and being
 *    dropped. Without it no queued sale can be turned into a valid request.
 *
 *    Resolving it later by SKU is not acceptable: SKU is not unique across
 *    stores, and a catalog re-sync between the sale and the push could point
 *    the same SKU at a different variant. A sale must name the exact variant
 *    that was actually sold.
 *
 * 2. THE DISCOUNT PERCENTAGE WAS LOSSY.
 *    `SaleLineInput.discount_pct` is a percentage, but only the resulting
 *    paise AMOUNT was stored. Recovering the percentage means dividing by the
 *    gross and rounding, which does not always return the number the cashier
 *    typed. The percentage is now stored as entered, in basis points, and the
 *    amount is kept alongside it — the label prints "30%" and the receipt
 *    prints the rupees, and both must reconcile without inference.
 *
 * WHY MRP AND HSN
 * ---------------
 * A physical label carries barcode, SKU, MRP, discount % and selling price as
 * five distinct facts. A GST receipt reprints MRP and HSN. Neither survives a
 * catalog edit unless it is snapshotted onto the line at sale time, exactly as
 * product_name and sku already are. Reading them back from the catalog later
 * would reprint TODAY's product against LAST YEAR's bill.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * - `client_uuid`: `sale.id` already IS the client uuid — checkout generates
 *   it and passes it as the primary key. A second column holding the same
 *   value could drift out of step with the first, which is strictly worse
 *   than having one. Documented and tested instead of duplicated.
 * - `cgst_paise` / `sgst_paise`: these are a presentation split of the tax
 *   already stored. Storing both halves invites them to disagree with the
 *   total by a paisa. The receipt derives them so they always sum exactly.
 * - `day_session_id`: an offline terminal has no server session id and cannot
 *   invent one. That is a backend/product decision, not a schema gap.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * Additive only. Every column is nullable or carries a default, so sales
 * written before this migration remain readable and keep their exact
 * financial values. Nothing is dropped, renamed or rewritten, and no existing
 * row is touched.
 */

import type { Migration } from './types';

export const migration005: Migration = {
  version: 5,
  name: 'sync-payload',
  up: (db) => {
    db.exec(`
      -- ---- sale_item: the sync payload + the reprintable receipt ----------

      -- THE BLOCKER. Server variant uuid. No FK: this names a row in
      -- PostgreSQL, not in the local catalog, and must stay valid even if the
      -- local catalog is wiped and re-synced.
      ALTER TABLE sale_item ADD COLUMN server_variant_id TEXT;

      -- Discount exactly as the cashier entered it. Basis points, matching
      -- tax_rate_bp: 30% -> 3000, 12.5% -> 1250. The paise amount already in
      -- discount_paise stays as it is; this records the INTENT, that records
      -- the EFFECT, and a receipt needs both.
      ALTER TABLE sale_item ADD COLUMN discount_pct_bp INTEGER NOT NULL DEFAULT 0;

      -- Printed on the label and on the bill. Snapshotted because a price
      -- revision must not rewrite a bill that was already handed over.
      ALTER TABLE sale_item ADD COLUMN mrp_paise INTEGER NOT NULL DEFAULT 0;

      -- Required on a GST invoice. Same snapshot reasoning.
      ALTER TABLE sale_item ADD COLUMN hsn_code TEXT;

      -- Sync reads pending lines by variant when reconciling a partial push.
      CREATE INDEX idx_sale_item_server_variant
        ON sale_item(server_variant_id);

      -- ---- sale: the remaining SaleCreate fields --------------------------

      -- Server user uuid for commission and performance attribution. Optional
      -- in SaleCreate, but if it is not captured at the counter it can never
      -- be recovered — the cashier is gone by the time anyone notices.
      ALTER TABLE sale ADD COLUMN server_salesperson_user_id TEXT;
    `);
  },
};
