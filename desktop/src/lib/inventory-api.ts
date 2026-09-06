import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type MovementKind =
  | 'purchase_receipt'
  | 'sale'
  | 'sale_return'
  | 'purchase_return'
  | 'adjustment'
  | 'transfer_out'
  | 'transfer_in'
  | 'opening_balance';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  purchase_receipt: 'Purchase Receipt',
  sale: 'Sale',
  sale_return: 'Sale Return',
  purchase_return: 'Purchase Return',
  adjustment: 'Adjustment',
  transfer_out: 'Transfer Out',
  transfer_in: 'Transfer In',
  opening_balance: 'Opening Balance',
};

export interface StockLevelRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  store_id: string;
  store_code: string;
  quantity: string;
  /** What it sells for. Display only — every write path prices the item
   *  itself; this is here so a picker can show a figure without a request
   *  per row. */
  selling_price: string;
  unit_symbol: string;
  unit_is_fractional: boolean;
  reorder_point: string;
  is_active: boolean;
}

/**
 * `negative` is deliberately separate from `out_of_stock`.
 *
 * A zero means the shelf is empty. A NEGATIVE means the books are wrong —
 * something was sold that the system did not know existed, a receipt was
 * never entered, or a count was posted against stock that had already moved.
 * It cannot be true of a physical shelf, so every such row is a data problem
 * somebody has to resolve. `out_of_stock` matches `<= 0` and therefore buries
 * them among the empty rows, which is exactly why they went unnoticed.
 */
export type StockFilter = 'in_stock' | 'out_of_stock' | 'low_stock' | 'negative';

export interface StockMovement {
  id: string;
  variant_id: string;
  store_id: string;
  kind: MovementKind;
  delta: string;
  balance_after: string;
  unit_cost: string | null;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export interface AdjustmentLine {
  variant_id: string;
  delta: string;
  unit_cost?: string | null;
}

export interface AdjustmentRequest {
  store_id: string;
  reason: string;
  lines: AdjustmentLine[];
}

export interface TransferRequest {
  from_store_id: string;
  to_store_id: string;
  reason?: string | null;
  lines: AdjustmentLine[];
}

export function stockLevels(params: {
  store_id?: string;
  search?: string;
  stock_filter?: StockFilter;
  include_inactive?: boolean;
  page?: number;
  page_size?: number;
} = {}): Promise<Paginated<StockLevelRow>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 500));
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.search) qs.set('search', params.search);
  if (params.stock_filter) qs.set('stock_filter', params.stock_filter);
  if (params.include_inactive) qs.set('include_inactive', 'true');
  return apiRequest({ path: `/inventory/levels?${qs.toString()}`, method: 'GET' });
}

export function listMovements(params: {
  variant_id?: string;
  store_id?: string;
  page?: number;
  page_size?: number;
} = {}): Promise<Paginated<StockMovement>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.variant_id) qs.set('variant_id', params.variant_id);
  if (params.store_id) qs.set('store_id', params.store_id);
  return apiRequest({ path: `/inventory/movements?${qs.toString()}`, method: 'GET' });
}

export function adjustStock(body: AdjustmentRequest): Promise<StockMovement[]> {
  return apiRequest({ path: '/inventory/adjust', method: 'POST', body });
}

export function transferStock(body: TransferRequest): Promise<StockMovement[]> {
  return apiRequest({ path: '/inventory/transfer', method: 'POST', body });
}
