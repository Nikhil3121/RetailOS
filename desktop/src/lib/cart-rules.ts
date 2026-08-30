/**
 * Cart business rules.
 *
 * Pure functions only — no React, no state, no side effects. Billing.tsx owns
 * the cart; this module owns the decisions about it, so the rules can be
 * tested without rendering a 1,500-line component.
 */

/** Minimal shape a cart line must have for these rules. Billing's `BillLine`
 *  satisfies it structurally, so no adapter or duplicate model is needed. */
export interface CartLineLike {
  variant_id: string;
}

/**
 * How the operator asked for this item.
 *
 * `barcode-scan` means the input matched a variant's BARCODE exactly — the
 * signature of a keyboard-wedge scanner firing. Only that source is subject to
 * the duplicate rule, because a scanner repeating itself is almost always an
 * accident (slow trigger, double beep, a re-scan to check the price).
 *
 * `manual` covers everything a human does deliberately: typing a SKU, picking
 * a row from the dropdown, arrow-keying to a result. All of it keeps the
 * pre-existing increment behaviour, which is how cashiers build quantity.
 */
export type AddSource = 'barcode-scan' | 'manual';

export type AddDecision =
  | { action: 'add' }
  | { action: 'increment' }
  | { action: 'reject'; reason: 'duplicate-barcode-scan'; message: string };

export const DUPLICATE_SCAN_MESSAGE = 'Already in this bill';

/**
 * Decide what a request to add `variantId` should do.
 *
 * Scoped entirely to the lines passed in — the ACTIVE cart. Nothing here
 * touches the catalog, inventory, or any persisted state, so the same barcode
 * scans cleanly again in the next bill. That is the whole point of taking
 * `lines` as an argument rather than reading global state.
 */
export function decideAdd(
  lines: readonly CartLineLike[],
  variantId: string,
  source: AddSource,
): AddDecision {
  const alreadyPresent = lines.some((line) => line.variant_id === variantId);

  if (!alreadyPresent) return { action: 'add' };

  if (source === 'barcode-scan') {
    return {
      action: 'reject',
      reason: 'duplicate-barcode-scan',
      message: DUPLICATE_SCAN_MESSAGE,
    };
  }

  // Manual entry — typed SKU or picker click — of something already in the
  // cart keeps the existing behaviour: bump the quantity.
  return { action: 'increment' };
}
