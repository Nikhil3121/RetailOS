/**
 * Catalog record validation.
 *
 * Server data is trusted more than renderer input, but not blindly — a bad
 * migration or a partially-written record upstream must not corrupt the local
 * catalog that the counter depends on. Anything that fails validation is
 * QUARANTINED with a reason, never silently dropped and never inserted.
 *
 * Money arrives from FastAPI as a Decimal serialised to a JSON string or
 * number ("199.50"). It is converted to integer paise here, at the boundary,
 * so nothing downstream ever handles a float rupee value.
 */

import type {
  RejectedRecord,
  StagedProduct,
  StagedVariant,
} from '../database/repositories/catalog-repository';

/** Raw shapes as they arrive from the API. Deliberately loose — this is
 *  untrusted input and the whole point is to check it. */
export interface RawVariant {
  id?: unknown;
  product_id?: unknown;
  name?: unknown;
  sku?: unknown;
  barcode?: unknown;
  attributes?: unknown;
  cost_price?: unknown;
  mrp?: unknown;
  selling_price?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
  updated_at?: unknown;
}

export interface RawProduct {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  hsn_code?: unknown;
  tax_rate?: unknown;
  brand_id?: unknown;
  category_id?: unknown;
  unit_id?: unknown;
  is_active?: unknown;
  variants?: unknown;
  updated_at?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decimal-string or number to integer paise.
 *
 * Rounds rather than truncates — 199.995 becoming 19999 would lose half a
 * paisa on every line. Returns null for anything unparseable so the caller
 * can reject the record rather than storing a zero price.
 */
export function toPaise(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Percentage ("5", "12.5") to basis points. 5% -> 500. */
export function toBasisPoints(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Barcode sanity. Deliberately permissive on format — Indian retail carries
 * EAN-13, UPC, and shop-printed codes of varying length — but rejects
 * whitespace and control characters, which break exact-match lookup in ways
 * that are very hard to diagnose at a counter.
 */
function normaliseBarcode(v: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, reason: 'barcode is not a string' };
  const trimmed = v.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 64) return { ok: false, reason: 'barcode exceeds 64 characters' };
  if (/\s/.test(trimmed)) return { ok: false, reason: 'barcode contains whitespace' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return { ok: false, reason: 'barcode contains control characters' };
  return { ok: true, value: trimmed };
}

export interface ValidationOutput {
  products: StagedProduct[];
  variants: StagedVariant[];
  rejects: RejectedRecord[];
}

/**
 * Validate a batch of products (with embedded variants) from the API.
 *
 * Duplicate barcodes are resolved by FIRST WINS, with the loser quarantined.
 * Silently letting the second overwrite the first would mean a scan resolves
 * to an arbitrary item depending on sync order — worse than not stocking it.
 */
export function validateCatalog(rawProducts: RawProduct[]): ValidationOutput {
  const products: StagedProduct[] = [];
  const variants: StagedVariant[] = [];
  const rejects: RejectedRecord[] = [];

  const seenBarcodes = new Map<string, string>(); // barcode -> owning variant id
  const seenVariantIds = new Set<string>();
  const seenProductIds = new Set<string>();

  const reject = (
    reason: string,
    productId: string | null,
    variantId: string | null,
    raw: unknown,
  ) => {
    rejects.push({
      serverProductId: productId,
      serverVariantId: variantId,
      reason,
      raw: JSON.stringify(raw),
    });
  };

  for (const p of rawProducts) {
    const pid = typeof p.id === 'string' ? p.id : null;

    if (!pid || !UUID_RE.test(pid)) {
      reject('product id missing or not a UUID', pid, null, p);
      continue;
    }
    if (seenProductIds.has(pid)) {
      reject('duplicate product id in batch', pid, null, p);
      continue;
    }
    if (!isNonEmptyString(p.name)) {
      reject('product name missing', pid, null, p);
      continue;
    }

    const taxBp = toBasisPoints(p.tax_rate);
    if (taxBp === null) {
      // A wrong tax rate produces wrong invoices and wrong GST returns.
      // Better to have no product than a mispriced one.
      reject('product tax_rate invalid', pid, null, p);
      continue;
    }

    seenProductIds.add(pid);
    products.push({
      serverProductId: pid,
      name: p.name.trim(),
      description: isNonEmptyString(p.description) ? p.description : null,
      hsnCode: isNonEmptyString(p.hsn_code) ? p.hsn_code : null,
      taxRateBp: taxBp,
      categoryId: typeof p.category_id === 'string' ? p.category_id : null,
      brandId: typeof p.brand_id === 'string' ? p.brand_id : null,
      unitId: typeof p.unit_id === 'string' ? p.unit_id : null,
      isActive: p.is_active !== false,
      updatedAt: isNonEmptyString(p.updated_at) ? p.updated_at : new Date().toISOString(),
    });

    const rawVariants = Array.isArray(p.variants) ? (p.variants as RawVariant[]) : [];
    for (const v of rawVariants) {
      const vid = typeof v.id === 'string' ? v.id : null;

      if (!vid || !UUID_RE.test(vid)) {
        reject('variant id missing or not a UUID', pid, vid, v);
        continue;
      }
      if (seenVariantIds.has(vid)) {
        reject('duplicate variant id in batch', pid, vid, v);
        continue;
      }
      if (!isNonEmptyString(v.sku)) {
        reject('variant sku missing', pid, vid, v);
        continue;
      }

      const barcode = normaliseBarcode(v.barcode);
      if (!barcode.ok) {
        reject(barcode.reason, pid, vid, v);
        continue;
      }
      if (barcode.value !== null) {
        const owner = seenBarcodes.get(barcode.value);
        if (owner) {
          reject(`duplicate barcode, already used by variant ${owner}`, pid, vid, v);
          continue;
        }
      }

      const selling = toPaise(v.selling_price);
      const mrp = toPaise(v.mrp);
      const cost = toPaise(v.cost_price);
      if (selling === null) {
        reject('variant selling_price invalid', pid, vid, v);
        continue;
      }

      if (barcode.value !== null) seenBarcodes.set(barcode.value, vid);
      seenVariantIds.add(vid);

      variants.push({
        serverVariantId: vid,
        serverProductId: pid,
        name: isNonEmptyString(v.name) ? v.name.trim() : 'Default',
        sku: v.sku.trim(),
        barcode: barcode.value,
        attributes:
          v.attributes && typeof v.attributes === 'object'
            ? JSON.stringify(v.attributes)
            : null,
        mrpPaise: mrp ?? selling,   // fall back to selling price when MRP absent
        sellingPricePaise: selling,
        costPricePaise: cost ?? 0,
        sortOrder: typeof v.sort_order === 'number' ? v.sort_order : 0,
        isActive: v.is_active !== false,
        updatedAt: isNonEmptyString(v.updated_at) ? v.updated_at : new Date().toISOString(),
      });
    }
  }

  return { products, variants, rejects };
}
