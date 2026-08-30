/**
 * What a cart line and a bill look like to the cashier and the customer.
 *
 * ── PRESENTATION ONLY ──────────────────────────────────────────────────────
 * Nothing here decides money. The authoritative arithmetic stays where it is:
 * `computeTotals` in Billing.tsx for the bill, and `computeLineMoney` in
 * local-checkout.ts for what gets stored. This module answers a narrower
 * question — "what should the cashier SEE?" — using the same inputs.
 *
 * That separation matters because the shop's pricing has three numbers that
 * are easy to confuse:
 *
 *     MRP           printed on the label      343.00
 *     unit price    what the line charges     343.00
 *     line total    after discount            240.10
 *
 * The saving is real and the customer expects to see it, but it must never be
 * computed a second way from a second source. Everything below derives from
 * the line the cart already holds.
 *
 * Extracted into a pure module for the same reason cart-rules.ts was: so the
 * awkward cases are tested directly rather than by rendering a page.
 */

export interface PresentableLine {
  unit_price: string;
  mrp?: string | null;
  quantity: number;
  discount_pct: number;
}

export interface LinePresentation {
  /** price x quantity, before any discount. */
  gross: number;
  /** What this line adds to the bill. */
  lineTotal: number;
  /** Money off, from the line discount. Zero when there is none. */
  discountAmount: number;
  /** MRP x quantity, when an MRP is known. Null when it is not. */
  mrpTotal: number | null;
  /** What the customer saved against MRP. Null when unknowable, 0 when none. */
  savedAgainstMrp: number | null;
  /** True when there is a saving worth showing. */
  showsSaving: boolean;
}

/** Two decimal places, matching the rest of the billing screen. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Everything a cart row needs to display.
 *
 * `savedAgainstMrp` is deliberately null rather than 0 when no MRP is known:
 * "we cannot tell you the saving" and "there is no saving" are different
 * statements, and showing "₹0 saved" for the first would be a small lie.
 */
export function presentLine(line: PresentableLine): LinePresentation {
  const price = Number(line.unit_price) || 0;

  // Intermediates are kept UNROUNDED and only the outputs are rounded, which
  // is exactly what computeLineMoney() does when it writes the sale. Rounding
  // the gross first shifted `129.99 x 2.5 @ 12.5%` by a paisa, so the cart
  // would have displayed 284.36 for a line the bill charged 284.35 at. The
  // stored figure is authoritative; this mirrors it rather than competing.
  const grossExact = price * line.quantity;
  const discountExact = grossExact * (line.discount_pct / 100);
  const lineTotalExact = grossExact - discountExact;

  const gross = round(grossExact);
  const discountAmount = round(discountExact);
  const lineTotal = round(lineTotalExact);

  const mrpValue = line.mrp === null || line.mrp === undefined ? null : Number(line.mrp);
  const mrpTotal =
    mrpValue !== null && Number.isFinite(mrpValue) && mrpValue > 0
      ? round(mrpValue * line.quantity)
      : null;

  const savedAgainstMrp = mrpTotal === null ? null : round(Math.max(mrpTotal - lineTotal, 0));

  return {
    gross,
    lineTotal,
    discountAmount,
    mrpTotal,
    savedAgainstMrp,
    // A saving of zero is not worth the ink, and a "saving" that is really a
    // markup (line total above MRP) must never be advertised as one.
    showsSaving: savedAgainstMrp !== null && savedAgainstMrp > 0,
  };
}

export interface BillSavings {
  /** Total saved against MRP across every line that has one. */
  totalSaved: number;
  /** Lines that contributed a saving. */
  linesWithSaving: number;
  /** False when no line has an MRP, so the UI can stay silent. */
  known: boolean;
}

/**
 * The bill-level saving.
 *
 * Sums only lines that actually have an MRP. A cart where nothing has an MRP
 * reports `known: false` so the screen shows nothing at all, rather than a
 * confident "You saved ₹0.00".
 */
export function summariseSavings(lines: PresentableLine[]): BillSavings {
  let totalSaved = 0;
  let linesWithSaving = 0;
  let anyMrp = false;

  for (const line of lines) {
    const presented = presentLine(line);
    if (presented.savedAgainstMrp === null) continue;
    anyMrp = true;
    if (presented.savedAgainstMrp > 0) {
      totalSaved = round(totalSaved + presented.savedAgainstMrp);
      linesWithSaving += 1;
    }
  }

  return { totalSaved, linesWithSaving, known: anyMrp };
}

/**
 * Cash amounts worth offering as one-tap buttons.
 *
 * Cash is most bills here, and typing the tendered amount for each one is the
 * slowest part of the flow. The suggestions are: the exact total, then the
 * next few round notes above it — the amounts a customer actually hands over.
 * Indian notes are 10/20/50/100/200/500/2000, so rounding to 50/100/500/2000
 * covers nearly every real tender.
 */
export function cashSuggestions(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];

  const exact = round(total);
  const candidates = new Set<number>([exact]);

  for (const step of [50, 100, 500, 2000]) {
    const rounded = Math.ceil(exact / step) * step;
    // Only useful if it is actually more than the bill; otherwise it IS the
    // exact amount and is already offered.
    if (rounded > exact) candidates.add(rounded);
  }

  return [...candidates].sort((a, b) => a - b).slice(0, 4);
}
