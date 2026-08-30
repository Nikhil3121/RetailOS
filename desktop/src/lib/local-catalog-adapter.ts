/**
 * Bridge between the local SQLite catalog and the cart's existing model.
 *
 * The catalog stores integer paise and basis points; the cart carries rupee
 * strings and percentage strings because that is what the FastAPI payload uses
 * and what `computeTotals()` already parses. Rather than change the cart model
 * — which would touch GST maths and the online path — this adapter converts at
 * the boundary. One cart implementation, two sources.
 */

import type { LocalVariant } from '@/lib/catalog-service';

/** Mirrors Billing's `PickerVariant`. Kept structural so no import cycle and
 *  no change to Billing's own type is needed. */
export interface PickerVariantLike {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  mrp: string | null;
  hsn_code: string | null;
}

/** Paise to the rupee string the cart expects ("89900" -> "899.00"). */
export function paiseToRupeeString(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Basis points to the percentage string the cart expects (500 -> "5"). */
export function basisPointsToPercentString(bp: number): string {
  const pct = bp / 100;
  // Trim a trailing ".00" so "5" reads naturally, but keep "12.5" intact.
  return Number.isInteger(pct) ? String(pct) : String(pct);
}

/**
 * Convert a local catalog hit into the shape `addVariant()` already accepts.
 *
 * `variant_id` is the SERVER variant uuid, not the local row id — the cart,
 * the duplicate-scan rule and the online sale payload all key on server
 * identity, so using the local id here would break all three.
 */
export function toPickerVariant(v: LocalVariant): PickerVariantLike {
  return {
    variant_id: v.serverVariantId,
    sku: v.sku,
    barcode: v.barcode,
    product_name: v.productName,
    variant_name: v.variantName,
    unit_price: paiseToRupeeString(v.sellingPricePaise),
    tax_rate: basisPointsToPercentString(v.taxRateBp),
    // Both are already in the local catalog and both are printed on the
    // bill, so they travel with the line instead of being looked up again
    // at print time against a catalog that may have changed since.
    mrp: v.mrpPaise > 0 ? paiseToRupeeString(v.mrpPaise) : null,
    hsn_code: v.hsnCode,
  };
}
