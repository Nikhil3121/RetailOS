/**
 * Physical stock audit — count sheets and their variances.
 *
 * WHY THE SHOP NEEDS THIS BEFORE IT NEEDS ANYTHING ELSE
 * The legacy import brought over products and variants but deliberately NOT
 * stock, because the old system's quantities could not be trusted. Every
 * variant reads zero until someone walks the floor with a sheet, and until
 * then no stock figure in the software means anything.
 *
 * WHAT A COUNT POSTS
 * The VARIANCE, never the total. A sheet counted at 6pm and posted at 9pm has
 * an evening of sales inside it; setting the balance to the counted figure
 * would put every one of those units back on the shelf. The server snapshots
 * what the books said when each line was entered and posts the difference.
 */

import { apiRequest } from '@/lib/api';

export type StockCountStatus = 'draft' | 'posted' | 'cancelled';

export interface StockCountLine {
  id: string;
  variant_id: string;
  /**
   * What the books said when the line was entered.
   *
   * NULL while a blind count is open — the server withholds it rather than
   * trusting this screen to hide it, because a figure in the payload is one
   * devtools tab away from the person who is supposed to be counting.
   */
  system_qty: string | null;
  counted_qty: string;
  /** counted − system. Also null on an open blind count. */
  variance: string | null;
  reason: string | null;
  sku: string | null;
  product_name: string | null;
  variant_label: string | null;
}

export interface StockCount {
  id: string;
  store_id: string;
  reference: string;
  scope: string | null;
  status: StockCountStatus;
  is_blind: boolean;
  notes: string | null;
  counted_by_user_id: string | null;
  posted_by_user_id: string | null;
  posted_at: string | null;
  lines: StockCountLine[];
  line_count: number;
  variance_line_count: number | null;
  net_variance: string | null;
}

export interface StockCountSummary {
  id: string;
  store_id: string;
  reference: string;
  scope: string | null;
  status: StockCountStatus;
  is_blind: boolean;
  line_count: number;
  created_at: string | null;
  posted_at: string | null;
}

export interface StockCountPostResult {
  count_id: string;
  status: StockCountStatus;
  /** Lines that moved the ledger. A zero variance writes nothing. */
  movements_posted: number;
  net_variance: string;
  /**
   * Variants whose balance changed between counting and posting.
   *
   * Not an error: the variance is applied on top of the real movement, which
   * is correct. Surfaced because a manager reviewing a big discrepancy should
   * know the shelf was being sold from while it was counted.
   */
  drifted_variant_ids: string[];
}

export interface StockCountLineInput {
  variant_id: string;
  counted_qty: string;
  reason?: string | null;
}

export function listStockCounts(params: {
  store_id?: string;
  status?: StockCountStatus;
} = {}): Promise<StockCountSummary[]> {
  const qs = new URLSearchParams();
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();
  return apiRequest({ path: `/stock-counts${query ? `?${query}` : ''}`, method: 'GET' });
}

export function getStockCount(id: string): Promise<StockCount> {
  return apiRequest({ path: `/stock-counts/${id}`, method: 'GET' });
}

export function createStockCount(body: {
  store_id: string;
  reference: string;
  scope?: string | null;
  is_blind?: boolean;
  notes?: string | null;
}): Promise<StockCount> {
  return apiRequest({ path: '/stock-counts', method: 'POST', body });
}

/** Save counted quantities. Re-counting an item REPLACES its line. */
export function saveStockCountLines(
  id: string,
  lines: StockCountLineInput[],
): Promise<StockCount> {
  return apiRequest({ path: `/stock-counts/${id}/lines`, method: 'PUT', body: { lines } });
}

export function deleteStockCountLine(id: string, lineId: string): Promise<StockCount> {
  return apiRequest({ path: `/stock-counts/${id}/lines/${lineId}`, method: 'DELETE' });
}

/** Accept the variances and correct the ledger. Manager and above. */
export function postStockCount(id: string): Promise<StockCountPostResult> {
  return apiRequest({ path: `/stock-counts/${id}/post`, method: 'POST' });
}

export function cancelStockCount(id: string): Promise<StockCount> {
  return apiRequest({ path: `/stock-counts/${id}/cancel`, method: 'POST' });
}
