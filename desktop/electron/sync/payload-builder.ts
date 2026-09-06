/**
 * Reconstruct the FastAPI `SaleCreate` payload from a committed local sale.
 *
 * PURE. No network, no database, no clock. That is deliberate: the dry-run
 * and the real push call this exact function, so a dry-run that produces a
 * valid payload proves the real push will send the same bytes. A dry-run that
 * exercised a different code path would prove nothing.
 *
 * ── THE CENTRAL RULE ───────────────────────────────────────────────────────
 * Every line uses `sale_item.server_variant_id` and nothing else.
 *
 * The catalog is NEVER consulted. Not by SKU, not by barcode, not by name.
 * A sale is a historical fact about a specific variant; re-deriving that
 * identity later against a catalog that has since been re-synced, re-priced
 * or re-SKU'd could attach a bill to the wrong product. If the recorded
 * variant id is missing, this refuses to build a payload rather than guess.
 */

import type { SaleRecord } from '../database/repositories/sale-repository';
import {
  basisPointsToDecimalString,
  paiseToDecimalString,
  quantityToDecimalString,
} from './money';

/** Mirrors backend/app/schemas/sale.py — SaleLineInput. */
export interface SaleLinePayload {
  variant_id: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  /** The amount ACTUALLY charged for this line (Phase 5B). Sent because a
   *  shelf price is often rounded — 343 less 30% is 240.10, the customer pays
   *  240.00 — and without it the server re-derives a total that never
   *  changed hands. */
  line_total: string;
  /** GST rate in force when the bill was printed, so a later catalog change
   *  cannot restate the tax on a historical sale. */
  tax_rate: string;
}

/** Mirrors SalePaymentInput. */
export interface SalePaymentPayload {
  method: string;
  amount: string;
  reference: string | null;
}

/** Mirrors SaleCreate. */
export interface SaleCreatePayload {
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  /** The session open WHEN THE SALE HAPPENED (Phase 5E). Null for a sale
   *  recorded before 007, which the server then treats exactly as before. */
  day_session_id: string | null;
  /** True occurrence time. Drives the server's invoice month. */
  occurred_at: string | null;
  /** device_uuid of the till that rang the sale. */
  terminal_uuid: string | null;
  lines: SaleLinePayload[];
  payments: SalePaymentPayload[];
  notes: string | null;
  /**
   * Money off the whole bill, as the cashier gave it — INCLUDING the rupee
   * value of any points redeemed, which is how the server carries it too.
   *
   * Sent because the server does not recompute it. Omitting it would let a
   * bill that was discounted at the counter sync at its gross value, so the
   * customer's receipt and the accounts would permanently disagree.
   */
  bill_discount?: string;
  bill_discount_reason?: string | null;
  /**
   * Points to debit. Deliberately NOT sent for an offline bill — see
   * buildSaleCreatePayload. Present on the type because the same shape is
   * used for the online path.
   */
  redeem_points?: string;
  round_off_enabled?: boolean;
  client_uuid: string;
}

export type BuildResult =
  | { ok: true; payload: SaleCreatePayload }
  | { ok: false; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the payload, or explain precisely why it cannot be built.
 *
 * Every failure here is PERMANENT by nature — a sale missing its store id
 * will still be missing it in an hour. Retrying would be pointless noise, so
 * the caller classifies these as permanent and stops.
 */
export function buildSaleCreatePayload(sale: SaleRecord): BuildResult {
  // `store_id` is required and unconditional on the backend.
  if (!sale.serverStoreId) {
    return { ok: false, reason: 'Sale has no server store id.' };
  }
  if (!UUID_RE.test(sale.serverStoreId)) {
    return { ok: false, reason: 'Server store id is not a valid UUID.' };
  }
  // `lines` has min_length=1. An empty bill would be rejected by Pydantic;
  // catching it here keeps a pointless round trip off the wire.
  if (sale.items.length === 0) {
    return { ok: false, reason: 'Sale has no line items.' };
  }
  // The client uuid IS the local primary key. It must never be regenerated.
  if (!sale.id) {
    return { ok: false, reason: 'Sale has no client uuid.' };
  }

  const lines: SaleLinePayload[] = [];

  for (const [index, item] of sale.items.entries()) {
    // THE BLOCKER, checked per line. A sale recorded before migration 005 has
    // no variant id, and there is no honest way to invent one.
    if (!item.serverVariantId) {
      return {
        ok: false,
        reason: `Line ${index + 1} (${item.sku ?? 'no SKU'}) has no server variant id.`,
      };
    }
    if (!UUID_RE.test(item.serverVariantId)) {
      return { ok: false, reason: `Line ${index + 1} variant id is not a valid UUID.` };
    }
    if (!(item.quantity > 0)) {
      return { ok: false, reason: `Line ${index + 1} has a non-positive quantity.` };
    }

    lines.push({
      variant_id: item.serverVariantId,
      quantity: quantityToDecimalString(item.quantity),
      // Send the price that was ACTUALLY CHARGED. Omitting it would let the
      // server fall back to the variant's current selling_price, so a price
      // revision between the sale and the sync would rewrite a bill the
      // customer has already paid.
      unit_price: paiseToDecimalString(item.unitPricePaise),
      // The percentage as the cashier entered it (migration 005). Never
      // recomputed from discount_paise — that division does not reliably
      // return the number that was typed.
      discount_pct: basisPointsToDecimalString(item.discountPctBp),
      // The two fields that make CUSTOMER RECEIPT == SQLITE == POSTGRESQL
      // hold. Both come straight from the committed snapshot; neither is
      // recomputed here, and the catalog is never consulted.
      line_total: paiseToDecimalString(item.lineTotalPaise),
      tax_rate: basisPointsToDecimalString(item.taxRateBp),
    });
  }

  const payments: SalePaymentPayload[] = [];
  for (const payment of sale.payments) {
    // The backend requires amount > 0. A zero-amount row would fail
    // validation for the whole bill, so it is dropped rather than sent —
    // it carries no financial information either way.
    if (payment.amountPaise <= 0) continue;
    payments.push({
      method: payment.method,
      amount: paiseToDecimalString(payment.amountPaise),
      // Card/UPI transaction reference. Explicitly preserved — this is what
      // makes a non-cash payment reconcilable against a bank statement.
      reference: payment.reference ?? null,
    });
  }

  return {
    ok: true,
    payload: {
      store_id: sale.serverStoreId,
      customer_id: sale.serverCustomerId ?? null,
      salesperson_user_id: sale.serverSalespersonUserId ?? null,
      // Straight from the committed snapshot. The session is NEVER resolved
      // here: re-deriving it at push time is precisely what books an overnight
      // bill into the wrong shift.
      day_session_id: sale.serverDaySessionId ?? null,
      occurred_at: sale.occurredAt ?? null,
      terminal_uuid: sale.terminalUuid ?? null,
      lines,
      payments,
      notes: sale.notes ?? null,
      // THE OFFLINE ADJUSTMENTS.
      //
      // `billDiscountPaise` already contains the rupee value of any points
      // redeemed — local-checkout folds them together exactly as the server
      // does, so one figure covers both and the two records reconcile.
      //
      // And that is WHY `redeem_points` is not sent. If it were, the server
      // would debit the ledger and add the value AGAIN on top of a discount
      // that already includes it, taking the money off twice. The points are
      // deducted by the till at redemption time; a bill rung offline settles
      // its own discount and leaves the ledger to the online path.
      ...(sale.billDiscountPaise > 0
        ? {
            bill_discount: paiseToDecimalString(sale.billDiscountPaise),
            bill_discount_reason: sale.billDiscountReason ?? null,
          }
        : {}),
      // Whether the counter rounded, not by how much. The server recomputes
      // the rounding from its own total, and sending our figure could only
      // ever disagree with it.
      round_off_enabled: sale.roundOffPaise !== 0,
      client_uuid: sale.id,
    },
  };
}

/**
 * A shape-only summary of a payload, safe to write to a log file.
 *
 * Logs on a shop counter PC are not a confidential store. Customer and
 * salesperson ids identify real people, and a payment reference is a
 * transaction identifier, so none of them appear here — only whether they are
 * present. Totals are included because a sync problem is almost always a
 * money problem, and debugging one blind is worse.
 */
export function describePayload(payload: SaleCreatePayload): Record<string, unknown> {
  return {
    client_uuid: payload.client_uuid,
    store_id: payload.store_id,
    has_customer: payload.customer_id !== null,
    has_salesperson: payload.salesperson_user_id !== null,
    day_session_id: payload.day_session_id,
    occurred_at: payload.occurred_at,
    has_terminal: payload.terminal_uuid !== null,
    line_count: payload.lines.length,
    payment_count: payload.payments.length,
    payment_methods: payload.payments.map((p) => p.method),
    payments_have_reference: payload.payments.map((p) => p.reference !== null),
    has_notes: payload.notes !== null,
    line_totals: payload.lines.map((l) => ({
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_pct: l.discount_pct,
      line_total: l.line_total,
      tax_rate: l.tax_rate,
    })),
  };
}
