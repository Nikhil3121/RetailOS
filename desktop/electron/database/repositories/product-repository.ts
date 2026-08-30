/**
 * Product catalog reads.
 *
 * The catalog is a cache of server-owned data — this repository never writes
 * from user action, only from a future sync-down. For this phase it provides
 * the read shapes the billing screen will eventually need, so the IPC surface
 * and its validation can be built and tested now.
 *
 * NOTE: Billing still reads products over HTTP today. Nothing here is wired
 * into it. Migrating billing to these methods is a later phase.
 */

import type { Db } from '../connection';

export interface ProductSearchResult {
  id: string;
  serverId: string | null;
  name: string;
  sku: string | null;
  hsn: string | null;
  barcode: string | null;
  mrpPaise: number | null;
  salePaise: number | null;
}

/**
 * Escape LIKE wildcards in operator input so a product literally named
 * "50% cotton" cannot be typed as a pattern that matches everything.
 * Paired with ESCAPE '\' in the queries below.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class ProductRepository {
  constructor(private readonly db: Db) {}

  /**
   * Exact barcode or SKU lookup — the scanner path.
   *
   * Kept separate from `search` because scanner behaviour must be
   * unambiguous: an exact hit returns that one product and nothing else.
   */
  findByCode(code: string): ProductSearchResult | null {
    const row = this.db
      .prepare(
        `SELECT p.id, p.server_id, p.name, p.sku, p.hsn,
                b.barcode,
                pr.mrp_paise, pr.sale_paise
           FROM product p
           LEFT JOIN product_barcode b ON b.product_id = p.id
           LEFT JOIN price pr          ON pr.product_id = p.id
          WHERE p.is_active = 1
            AND (b.barcode = ? OR p.sku = ?)
          LIMIT 1`,
      )
      .get(code, code) as
      | {
          id: string;
          server_id: string | null;
          name: string;
          sku: string | null;
          hsn: string | null;
          barcode: string | null;
          mrp_paise: number | null;
          sale_paise: number | null;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      sku: row.sku,
      hsn: row.hsn,
      barcode: row.barcode,
      mrpPaise: row.mrp_paise,
      salePaise: row.sale_paise,
    };
  }

  /**
   * Fuzzy search across name, SKU, HSN and barcode.
   *
   * `limit` is clamped in the caller (IPC validation) as well as here — a
   * renderer bug asking for 100,000 rows should degrade, not hang the counter.
   */
  search(query: string, limit = 50): ProductSearchResult[] {
    const term = `%${escapeLike(query.trim())}%`;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const rows = this.db
      .prepare(
        `SELECT p.id, p.server_id, p.name, p.sku, p.hsn,
                b.barcode,
                pr.mrp_paise, pr.sale_paise
           FROM product p
           LEFT JOIN product_barcode b ON b.product_id = p.id
           LEFT JOIN price pr          ON pr.product_id = p.id
          WHERE p.is_active = 1
            AND (p.name LIKE ? ESCAPE '\\'
              OR p.sku  LIKE ? ESCAPE '\\'
              OR p.hsn  LIKE ? ESCAPE '\\'
              OR b.barcode LIKE ? ESCAPE '\\')
          ORDER BY p.name
          LIMIT ?`,
      )
      .all(term, term, term, term, safeLimit) as {
      id: string;
      server_id: string | null;
      name: string;
      sku: string | null;
      hsn: string | null;
      barcode: string | null;
      mrp_paise: number | null;
      sale_paise: number | null;
    }[];

    return rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      sku: row.sku,
      hsn: row.hsn,
      barcode: row.barcode,
      mrpPaise: row.mrp_paise,
      salePaise: row.sale_paise,
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM product').get() as { n: number };
    return row.n;
  }
}
