import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type SaleStatus = 'completed' | 'voided';
/**
 * `credit_note` is the value of returned goods spent on the bill replacing
 * them. A tender, not a discount — and deliberately not cash, because nothing
 * moved through the drawer.
 */
export type PaymentMethod = 'cash' | 'card' | 'upi' | 'other' | 'credit_note';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  other: 'Other',
  credit_note: 'Credit note',
};

export interface SaleLine {
  id: string;
  sale_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  hsn_code: string | null;
  quantity: string;
  unit_price: string;
  /** Printed MRP at the time of sale. Null on bills written before this existed. */
  mrp: string | null;
  discount_pct: string;
  discount_amount: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  line_total: string;
  sort_order: number;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  created_at: string;
}

export interface Sale {
  /** Money off the whole bill, and where it came from. */
  bill_discount?: string;
  bill_discount_reason?: string | null;
  round_off?: string;
  coupon_id?: string | null;
  coupon_code?: string | null;
  /** Free gift earned on this bill. Snapshotted, so it survives the
   *  scheme being renamed or deleted. */
  reward_label?: string | null;
  reward_scheme_id?: string | null;
  id: string;
  number: string;
  store_id: string;
  day_session_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  status: SaleStatus;
  /**
   * What kind of document this is. A credit note is the SAME shape with
   * negative money, so anything that renders an amount must read this first —
   * otherwise a refund displays as a sale.
   */
  doc_type: SaleDocType;
  /** The invoice a credit note reverses. Always null on a sale. */
  original_sale_id: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  paid_total: string;
  change_due: string;
  balance_due: string;
  notes: string | null;
  completed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_user_id: string | null;
  /**
   * How many times this bill has been put on paper.
   *
   * 0 means no copy exists yet; every copy after the first is a DUPLICATE and
   * must say so on its face. A second unmarked copy of a GST invoice is how a
   * bill gets presented twice — for a return, for a warranty claim, to the
   * accountant — and neither copy can be told from the other.
   */
  print_count: number;
  lines: SaleLine[];
  payments: SalePayment[];
  created_at: string;
}

export interface SaleSummary {
  id: string;
  number: string;
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  status: SaleStatus;
  grand_total: string;
  paid_total: string;
  balance_due: string;
  line_count: number;
  completed_at: string | null;
  created_at: string;
}

export interface SaleLineInput {
  variant_id: string;
  quantity: string;
  unit_price?: string | null;
  discount_pct?: string;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: string;
  reference?: string | null;
}

export interface SaleCreate {
  store_id: string;
  customer_id?: string | null;
  /** Staff credited with the sale. Server falls back to the cashier if omitted. */
  salesperson_user_id?: string | null;
  lines: SaleLineInput[];
  /** Empty array = pure credit bill; whole grand total becomes balance_due. */
  payments: SalePaymentInput[];
  notes?: string | null;
  /**
   * Money off the WHOLE bill, applied after the lines are totalled.
   *
   * Deliberately not spread across the lines: allocating it would change each
   * line's taxable value and therefore its GST.
   */
  bill_discount?: string;
  bill_discount_reason?: string | null;
  /**
   * Loyalty points to spend on this bill.
   *
   * Sent WITH the sale rather than redeemed beforehand: the server debits the
   * points ledger and adds their rupee value to `bill_discount` inside the
   * same transaction that writes the sale. Redeeming first would leave a
   * window where the points are gone and no bill exists.
   *
   * Requires `customer_id` — points belong to a person, not to a walk-in.
   */
  redeem_points?: string;
  /** The coupon it came from. The server re-checks the amount against it. */
  coupon_id?: string | null;
  /** Round the final figure to the whole rupee, as a GST invoice usually does. */
  round_off_enabled?: boolean;
  /** Idempotency key for offline replay. Same UUID on every retry = one sale. */
  client_uuid?: string | null;
}

export interface SalePaymentCollect {
  method: PaymentMethod;
  amount: string;
  reference?: string | null;
}

export function listSales(params: {
  page?: number;
  page_size?: number;
  store_id?: string;
  status?: SaleStatus;
  /**
   * Invoice number, customer phone, or customer name.
   *
   * Phone matching ignores spaces, dashes and brackets — a customer who
   * returns without their bill gives a number, not a format.
   */
  search?: string;
  from_date?: string;
  to_date?: string;
} = {}): Promise<Paginated<SaleSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  if (params.from_date) qs.set('from_date', params.from_date);
  if (params.to_date) qs.set('to_date', params.to_date);
  return apiRequest({ path: `/sales?${qs.toString()}`, method: 'GET' });
}

export function getSale(id: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}`, method: 'GET' });
}

/**
 * Record that a paper copy of this bill was produced.
 *
 * Called on every print, INCLUDING the first — the counter is what decides
 * whether the next copy is marked DUPLICATE, so it has to count the original
 * too. Failure is swallowed by the caller: a printer that works and a counter
 * that did not increment is better than blocking the customer's bill.
 */
export function markSalePrinted(id: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/printed`, method: 'POST' });
}

export function createSale(body: SaleCreate): Promise<Sale> {
  return apiRequest({ path: '/sales', method: 'POST', body });
}

export function voidSale(id: string, reason: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/void`, method: 'POST', body: { reason } });
}

export function collectSalePayment(
  id: string,
  body: SalePaymentCollect,
): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/payments`, method: 'POST', body });
}

/* ---------------------------------------------------------------------------
 * Returns / credit notes
 * ------------------------------------------------------------------------ */

/**
 * A return is stored as a `sales` row with negative amounts, so every existing
 * report nets it out without change. Presentation is the opposite: a person is
 * shown a positive figure labelled "Credit note", never "-₹899".
 */
export type SaleDocType = 'sale' | 'return';

export interface ReturnableLine {
  sale_line_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  unit_price: string;
  sold_quantity: string;
  returned_quantity: string;
  /** What is genuinely left to credit — sold minus already returned. */
  returnable_quantity: string;
}

export interface SaleReturnLineInput {
  sale_line_id: string;
  /** POSITIVE — how many units are coming back. The server stores the negative. */
  quantity: string;
}

export interface SaleReturnBody {
  lines: SaleReturnLineInput[];
  /** Money going back, as positive amounts. Empty leaves the credit on account. */
  refunds: SalePaymentInput[];
  reason: string;
  notes?: string | null;
  client_uuid?: string | null;
  occurred_at?: string | null;
  terminal_uuid?: string | null;
  day_session_id?: string | null;
}

/** What can still be credited against a bill. Drives the return screen. */
export async function getReturnableLines(saleId: string): Promise<ReturnableLine[]> {
  return apiRequest({ path: `/sales/${saleId}/returnable`, method: 'GET' });
}

/** Credit part or all of a bill. Returns the credit note. */
export async function createSaleReturn(
  saleId: string,
  body: SaleReturnBody,
): Promise<Sale> {
  return apiRequest({ path: `/sales/${saleId}/returns`, method: 'POST', body });
}

/**
 * Absolute value for display.
 *
 * Credit notes carry negative money in storage. A cashier should read
 * "Credit note · ₹899", not "-₹899" — the sign is a database decision, and
 * `doc_type` already carries the meaning on screen.
 */
export function displayAmount(value: string | number): number {
  return Math.abs(Number(value) || 0);
}

/* ---------------------------------------------------------------------------
 * Exchange
 * ------------------------------------------------------------------------ */

export interface SaleExchangeBody {
  /** What is coming back, by ORIGINAL sale line. Prices are never sent —
   *  they are copied from the invoice being reversed. */
  lines: { sale_line_id: string; quantity: string }[];
  /** What the customer is taking instead. Priced as any other sale. */
  new_lines: SaleLineInput[];
  /** Anything paid ON TOP of the credit. */
  payments?: SalePaymentInput[];
  /**
   * How to hand back the difference when the returned goods are worth MORE.
   *
   * Omit to leave it as a balance on the credit note, which the customer can
   * spend later — the safer default, because money never leaves the drawer
   * unless somebody asked for it.
   */
  refund_excess_method?: PaymentMethod | null;
  reason: string;
  store_id?: string | null;
  customer_id?: string | null;
  salesperson_user_id?: string | null;
  notes?: string | null;
  round_off_enabled?: boolean;
}

export interface SaleExchangeResult {
  /** What came back. A document in its own right, at its true value. */
  credit_note: Sale;
  /** What went out. Also at its true value — the credit is a tender on it,
   *  not a discount off it. */
  sale: Sale;
  credit_applied: string;
  /** Still owed BY the customer. */
  balance_due: string;
  /** Owed TO the customer — either refunded, or left on the credit note. */
  credit_remaining: string;
}

/**
 * Swap goods for other goods in one action.
 *
 * Two documents come back, not one: under GST the return needs its own credit
 * note and the replacement is a sale at its own price with its own tax.
 * Netting them into a single discounted bill would understate the invoice and
 * leave the return unrecorded.
 */
export function createExchange(
  saleId: string,
  body: SaleExchangeBody,
): Promise<SaleExchangeResult> {
  return apiRequest({ path: `/sales/${saleId}/exchange`, method: 'POST', body });
}
