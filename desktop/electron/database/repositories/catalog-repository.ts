/**
 * Local catalog reads and the atomic snapshot swap.
 *
 * `findByBarcode` is the single most performance-sensitive query in the whole
 * application — a cashier scans, and the item must be in the cart before they
 * look up. It is a covered index seek: `idx_variant_barcode` is unique and
 * partial, so SQLite goes straight to the row with no scan and no sort.
 */

import { randomUUID } from 'node:crypto';

import type { Db } from '../connection';
import { log } from '../logger';

export interface CatalogVariant {
  variantId: string;
  serverVariantId: string;
  serverProductId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  hsnCode: string | null;
  taxRateBp: number;
  mrpPaise: number;
  sellingPricePaise: number;
}

export type CatalogStatus = 'NOT_INITIALIZED' | 'SYNCING' | 'READY' | 'FAILED';

export interface CatalogState {
  status: CatalogStatus;
  lastSuccessfulSync: string | null;
  lastAttemptAt: string | null;
  snapshotVersion: string | null;
  productCount: number;
  variantCount: number;
  storeId: string | null;
  error: string | null;
}

/** Validated, ready-to-insert shapes produced by the sync validator. */
export interface StagedProduct {
  serverProductId: string;
  name: string;
  description: string | null;
  hsnCode: string | null;
  taxRateBp: number;
  categoryId: string | null;
  brandId: string | null;
  unitId: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface StagedVariant {
  serverVariantId: string;
  serverProductId: string;
  name: string;
  sku: string;
  barcode: string | null;
  attributes: string | null;
  mrpPaise: number;
  sellingPricePaise: number;
  costPricePaise: number;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

/** Rows the validator refused, kept for diagnosis. */
export interface RejectedRecord {
  serverProductId: string | null;
  serverVariantId: string | null;
  reason: string;
  raw: string;
}

const SELECT_VARIANT = `
  SELECT v.id                  AS variant_id,
         v.server_variant_id,
         v.server_product_id,
         p.name                AS product_name,
         v.name                AS variant_name,
         v.sku, v.barcode,
         p.hsn AS hsn_code, p.tax_rate_bp,
         v.mrp_paise, v.selling_price_paise
    FROM product_variant v
    JOIN product p ON p.id = v.product_id
`;

interface VariantRow {
  variant_id: string;
  server_variant_id: string;
  server_product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  hsn_code: string | null;
  tax_rate_bp: number;
  mrp_paise: number;
  selling_price_paise: number;
}

function toVariant(r: VariantRow): CatalogVariant {
  return {
    variantId: r.variant_id,
    serverVariantId: r.server_variant_id,
    serverProductId: r.server_product_id,
    productName: r.product_name,
    variantName: r.variant_name,
    sku: r.sku,
    barcode: r.barcode,
    hsnCode: r.hsn_code,
    taxRateBp: r.tax_rate_bp,
    mrpPaise: r.mrp_paise,
    sellingPricePaise: r.selling_price_paise,
  };
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class CatalogRepository {
  constructor(private readonly db: Db) {}

  /**
   * Exact barcode match. THE scan path.
   *
   * Only active variants of active products are returned — a discontinued
   * item must not appear at the counter just because its barcode still exists.
   */
  findByBarcode(barcode: string): CatalogVariant | null {
    const row = this.db
      .prepare(
        `${SELECT_VARIANT} WHERE v.barcode = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`,
      )
      .get(barcode) as VariantRow | undefined;
    return row ? toVariant(row) : null;
  }

  /** Exact SKU match — fallback when a label is damaged or has no barcode. */
  findBySku(sku: string): CatalogVariant | null {
    const row = this.db
      .prepare(
        `${SELECT_VARIANT} WHERE v.sku = ? AND v.is_active = 1 AND p.is_active = 1 LIMIT 1`,
      )
      .get(sku) as VariantRow | undefined;
    return row ? toVariant(row) : null;
  }

  /**
   * Exact-first lookup, mirroring the scanner precedence Billing.tsx already
   * implements: an exact barcode wins, then an exact SKU. Never fuzzy —
   * a scan that half-matches must return nothing rather than a wrong item.
   */
  findByCode(code: string): CatalogVariant | null {
    return this.findByBarcode(code) ?? this.findBySku(code);
  }

  getVariant(variantId: string): CatalogVariant | null {
    const row = this.db
      .prepare(`${SELECT_VARIANT} WHERE v.id = ? LIMIT 1`)
      .get(variantId) as VariantRow | undefined;
    return row ? toVariant(row) : null;
  }

  /**
   * Fuzzy search for the picker. Exact barcode/SKU hits are ordered first so
   * a scan into the search box still behaves like a scan.
   */
  search(query: string, limit = 50): CatalogVariant[] {
    const raw = query.trim();
    if (!raw) return [];
    const term = `%${escapeLike(raw)}%`;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const rows = this.db
      .prepare(
        `${SELECT_VARIANT}
          WHERE v.is_active = 1 AND p.is_active = 1
            AND (v.barcode = ?
              OR v.sku = ?
              OR p.name LIKE ? ESCAPE '\\'
              OR v.name LIKE ? ESCAPE '\\'
              OR v.sku  LIKE ? ESCAPE '\\'
              OR p.hsn LIKE ? ESCAPE '\\')
          ORDER BY CASE WHEN v.barcode = ? OR v.sku = ? THEN 0 ELSE 1 END,
                   p.name, v.sort_order
          LIMIT ?`,
      )
      .all(raw, raw, term, term, term, term, raw, raw, safeLimit) as VariantRow[];

    return rows.map(toVariant);
  }

  counts(): { products: number; variants: number } {
    const p = this.db.prepare('SELECT COUNT(*) AS n FROM product').get() as { n: number };
    const v = this.db.prepare('SELECT COUNT(*) AS n FROM product_variant').get() as { n: number };
    return { products: p.n, variants: v.n };
  }

  // ---- state ----

  getState(): CatalogState {
    const row = this.db
      .prepare('SELECT * FROM catalog_sync WHERE singleton_guard = 1')
      .get() as {
      status: CatalogStatus;
      last_successful_sync: string | null;
      last_attempt_at: string | null;
      snapshot_version: string | null;
      product_count: number;
      variant_count: number;
      store_id: string | null;
      error: string | null;
    };
    return {
      status: row.status,
      lastSuccessfulSync: row.last_successful_sync,
      lastAttemptAt: row.last_attempt_at,
      snapshotVersion: row.snapshot_version,
      productCount: row.product_count,
      variantCount: row.variant_count,
      storeId: row.store_id,
      error: row.error,
    };
  }

  setStatus(status: CatalogStatus, error?: string | null): void {
    this.db
      .prepare(
        `UPDATE catalog_sync SET status = ?, error = ?, last_attempt_at = ?, updated_at = ?
         WHERE singleton_guard = 1`,
      )
      .run(status, error ?? null, new Date().toISOString(), new Date().toISOString());
  }

  /**
   * Replace the entire catalog atomically.
   *
   * Strategy: DELETE + INSERT inside ONE transaction. If anything throws —
   * a constraint violation, a duplicate barcode, a disk error — SQLite rolls
   * the whole thing back and the PREVIOUS CATALOG IS STILL THERE. There is no
   * window in which the POS has a half-updated catalog.
   *
   * A staging-table swap would also work, but delete+insert inside a
   * transaction gives the same guarantee with far less machinery, and 9,000
   * rows is small enough that the transaction is short.
   */
  replaceCatalog(input: {
    products: StagedProduct[];
    variants: StagedVariant[];
    rejects: RejectedRecord[];
    snapshotVersion: string;
    storeId: string | null;
  }): { products: number; variants: number; rejects: number } {
    const now = new Date().toISOString();

    const swap = this.db.transaction(() => {
      // ON DELETE CASCADE on product_variant.product_id clears variants, but
      // deleting explicitly makes the intent obvious and does not rely on the
      // foreign_keys pragma being on.
      this.db.prepare('DELETE FROM product_variant').run();
      this.db.prepare('DELETE FROM product').run();
      this.db.prepare('DELETE FROM catalog_reject').run();

      const insertProduct = this.db.prepare(
        `INSERT INTO product
           (id, server_id, name, description, sku, hsn, tax_rate_bp,
            category_id, brand_id, unit_id, is_active, updated_at, synced_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // Map server product id -> local product id so variants can be linked
      // without a lookup query per row.
      const productIdByServer = new Map<string, string>();

      for (const p of input.products) {
        const localId = randomUUID();
        productIdByServer.set(p.serverProductId, localId);
        insertProduct.run(
          localId,
          p.serverProductId,
          p.name,
          p.description,
          p.hsnCode,
          p.taxRateBp,
          p.categoryId,
          p.brandId,
          p.unitId,
          p.isActive ? 1 : 0,
          p.updatedAt,
          now,
        );
      }

      const insertVariant = this.db.prepare(
        `INSERT INTO product_variant
           (id, server_variant_id, product_id, server_product_id, name, sku, barcode,
            attributes, mrp_paise, selling_price_paise, cost_price_paise,
            sort_order, is_active, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      let variantCount = 0;
      for (const v of input.variants) {
        const localProductId = productIdByServer.get(v.serverProductId);
        // A variant whose product was rejected has nothing to attach to.
        // Skipping is correct: the validator already recorded why.
        if (!localProductId) continue;

        insertVariant.run(
          randomUUID(),
          v.serverVariantId,
          localProductId,
          v.serverProductId,
          v.name,
          v.sku,
          v.barcode,
          v.attributes,
          v.mrpPaise,
          v.sellingPricePaise,
          v.costPricePaise,
          v.sortOrder,
          v.isActive ? 1 : 0,
          v.updatedAt,
          now,
        );
        variantCount += 1;
      }

      const insertReject = this.db.prepare(
        `INSERT INTO catalog_reject
           (id, server_product_id, server_variant_id, reason, raw, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of input.rejects) {
        insertReject.run(
          randomUUID(),
          r.serverProductId,
          r.serverVariantId,
          r.reason,
          r.raw.slice(0, 2000),
          now,
        );
      }

      this.db
        .prepare(
          `UPDATE catalog_sync SET
             status = 'READY', last_successful_sync = ?, last_attempt_at = ?,
             snapshot_version = ?, product_count = ?, variant_count = ?,
             store_id = ?, error = NULL, updated_at = ?
           WHERE singleton_guard = 1`,
        )
        .run(
          now,
          now,
          input.snapshotVersion,
          input.products.length,
          variantCount,
          input.storeId,
          now,
        );

      return variantCount;
    });

    const variants = swap();

    log.info('catalog.replaced', {
      product_count: input.products.length,
      variant_count: variants,
      reject_count: input.rejects.length,
      snapshot_version: input.snapshotVersion,
    });

    return { products: input.products.length, variants, rejects: input.rejects.length };
  }

  recentRejects(limit = 50): RejectedRecord[] {
    const rows = this.db
      .prepare(
        `SELECT server_product_id, server_variant_id, reason, raw
           FROM catalog_reject ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as {
      server_product_id: string | null;
      server_variant_id: string | null;
      reason: string;
      raw: string;
    }[];
    return rows.map((r) => ({
      serverProductId: r.server_product_id,
      serverVariantId: r.server_variant_id,
      reason: r.reason,
      raw: r.raw,
    }));
  }
}
