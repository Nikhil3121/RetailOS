import { apiRequest } from '@/lib/api';

export interface SalesSummary {
  from_date: string;
  to_date: string;
  sales_count: number;
  gross_total: string;
  tax_total: string;
  discount_total: string;
  net_total: string;
  cash_total: string;
  card_total: string;
  upi_total: string;
  other_total: string;
}

export interface TopProductRow {
  variant_id: string;
  sku: string;
  product_name: string;
  quantity_sold: string;
  revenue: string;
}

export interface DailySalesRow {
  day: string;
  sales_count: number;
  gross_total: string;
}

function buildQS(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  return qs.toString();
}

export function salesSummary(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<SalesSummary> {
  return apiRequest({ path: `/reports/sales-summary?${buildQS(params)}`, method: 'GET' });
}

export function topProducts(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
  limit?: string;
} = {}): Promise<TopProductRow[]> {
  return apiRequest({ path: `/reports/top-products?${buildQS(params)}`, method: 'GET' });
}

export function dailyTrend(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<DailySalesRow[]> {
  return apiRequest({ path: `/reports/daily-trend?${buildQS(params)}`, method: 'GET' });
}

/* ---------------------------------------------------------------------------
 * Sales sliced by a dimension
 * ------------------------------------------------------------------------ */

export type SalesDimension = 'brand' | 'category' | 'size' | 'salesperson';

export interface SalesBreakdownRow {
  /** Null for a size (a variant name, not a row in a table) and for the
   *  "Unassigned" bucket every one of these dimensions has. */
  key_id: string | null;
  /** Never blank — an unlabelled row in a report is one nobody can act on. */
  label: string;
  quantity_sold: string;
  revenue: string;
  /** Share of the period's revenue, 0–100. Computed server-side so the screen
   *  and any export agree to the paisa. */
  share_pct: string;
}

export function salesBy(params: {
  dimension: SalesDimension;
  from_date?: string;
  to_date?: string;
  store_id?: string;
  limit?: string;
}): Promise<SalesBreakdownRow[]> {
  return apiRequest({ path: `/reports/sales-by?${buildQS(params)}`, method: 'GET' });
}

/* ---------------------------------------------------------------------------
 * Item-wise profit
 * ------------------------------------------------------------------------ */

export interface ItemProfitRow {
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  quantity_sold: string;
  revenue: string;
  cost: string | null;
  profit: string | null;
  margin_pct: string | null;
}

export interface ItemProfitReport {
  from_date: string;
  to_date: string;
  rows: ItemProfitRow[];
  total_revenue: string;
  total_cost: string;
  total_profit: string;
  /**
   * Sale lines in the period with no cost recorded, and therefore NOT in the
   * totals above.
   *
   * Bills written before costs were snapshotted carry none, and there is no
   * honest way to invent one. Anything rendering this report MUST show these
   * two figures when they are non-zero — a margin covering half the period,
   * presented as the whole, is worse than no margin at all.
   */
  uncosted_lines: number;
  uncosted_revenue: string;
}

export function itemProfit(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
  limit?: string;
} = {}): Promise<ItemProfitReport> {
  return apiRequest({ path: `/reports/item-profit?${buildQS(params)}`, method: 'GET' });
}

/* ---------------------------------------------------------------------------
 * Day book
 * ------------------------------------------------------------------------ */

export interface DayBookEntry {
  at: string;
  /** sale | return | collection | expense */
  kind: string;
  reference: string;
  party: string | null;
  /** Null on a credit sale, which moved goods and no money. */
  method: string | null;
  /** Signed: money in positive, money out negative. */
  amount: string;
}

export interface DayBook {
  day: string;
  store_id: string | null;
  entries: DayBookEntry[];
  /** Null when no day session was opened — different from "opened with zero",
   *  and the reason there may be no expected-cash figure. */
  opening_cash: string | null;
  sales_total: string;
  returns_total: string;
  collections_total: string;
  expenses_total: string;
  net_total: string;
  /** Cash only. The drawer never holds anything else. */
  cash_in: string;
  cash_out: string;
  expected_cash: string | null;
}

export function dayBook(params: {
  day?: string;
  store_id?: string;
} = {}): Promise<DayBook> {
  return apiRequest({ path: `/reports/day-book?${buildQS(params)}`, method: 'GET' });
}

/* ---------------------------------------------------------------------------
 * GSTR-1
 * ------------------------------------------------------------------------ */

export interface Gstr1RateLine {
  rate: string;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface Gstr1B2bInvoice {
  invoice_number: string;
  invoice_date: string;
  customer_gstin: string;
  customer_name: string;
  invoice_value: string;
  /** Two-digit state code, read from the customer's GSTIN. */
  place_of_supply: string;
  reverse_charge: boolean;
  lines: Gstr1RateLine[];
}

export interface Gstr1B2csRow {
  place_of_supply: string;
  rate: string;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
  invoice_count: number;
}

export interface Gstr1CreditNote {
  note_number: string;
  note_date: string;
  original_invoice_number: string | null;
  customer_gstin: string | null;
  customer_name: string | null;
  place_of_supply: string;
  /** POSITIVE, as the return expects — storage keeps returns negative. */
  note_value: string;
  lines: Gstr1RateLine[];
}

export interface Gstr1HsnRow {
  hsn_code: string;
  description: string;
  uqc: string;
  quantity: string;
  taxable_value: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface Gstr1DocumentRange {
  document_type: string;
  from_number: string;
  to_number: string;
  total_count: number;
  cancelled_count: number;
}

export interface Gstr1Return {
  gstin: string;
  store_name: string;
  from_date: string;
  to_date: string;
  b2b: Gstr1B2bInvoice[];
  b2cs: Gstr1B2csRow[];
  credit_notes: Gstr1CreditNote[];
  hsn: Gstr1HsnRow[];
  documents: Gstr1DocumentRange[];
  total_taxable_value: string;
  total_tax: string;
  total_invoice_value: string;
  /**
   * Bills the return could not fully classify, and why.
   *
   * MUST be shown. A missing HSN code or a malformed GSTIN means a line is
   * absent from a section of the return, and whoever files it will file short
   * without ever knowing.
   */
  warnings: string[];
}

/**
 * The GSTR-1 working paper for one branch and one period.
 *
 * Not a portal upload — see the endpoint's own note. It is the arithmetic,
 * laid out the way the return is laid out, so the figures can be tied to the
 * books without re-adding a month of bills by hand.
 */
export function gstr1(params: {
  store_id: string;
  from_date?: string;
  to_date?: string;
}): Promise<Gstr1Return> {
  return apiRequest({ path: `/reports/gstr1?${buildQS(params)}`, method: 'GET' });
}
