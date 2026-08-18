import { apiRequest } from '@/lib/api';

export type StockCategory = 'out_of_stock' | 'low' | 'healthy' | 'overstock';
export type MovementCategory = 'fast' | 'slow' | 'dead' | 'normal';

export const STOCK_LABEL: Record<StockCategory, string> = {
  out_of_stock: 'Out of stock',
  low: 'Low',
  healthy: 'Healthy',
  overstock: 'Overstock',
};

export const MOVEMENT_LABEL: Record<MovementCategory, string> = {
  fast: 'Fast moving',
  slow: 'Slow moving',
  dead: 'Dead',
  normal: 'Normal',
};

export interface StockAlertRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  barcode: string | null;
  store_id: string;
  store_code: string;
  quantity: string;
  reorder_point: string;
  reorder_quantity: string;
  overstock_point: string | null;
  category: StockCategory;
  days_of_cover: string | null;
  suggested_reorder_qty: string | null;
}

export interface MovementRow {
  variant_id: string;
  sku: string;
  product_name: string;
  on_hand: string;
  sold_last_window: string;
  velocity_per_day: string;
  last_sale_at: string | null;
  category: MovementCategory;
}

export interface InventoryValueRow {
  store_id: string;
  store_code: string;
  store_name: string;
  line_count: number;
  on_hand_units: string;
  inventory_value: string;
  at_cost: boolean;
}

export interface InventoryValueTotal {
  line_count: number;
  on_hand_units: string;
  inventory_value: string;
  per_store: InventoryValueRow[];
}

export interface InventoryAgingRow {
  variant_id: string;
  sku: string;
  product_name: string;
  store_id: string;
  store_code: string;
  quantity: string;
  last_inbound_at: string | null;
  days_since_inbound: number | null;
  bucket: string;
}

export interface InventoryHealthSummary {
  total_skus_in_stock: number;
  out_of_stock_count: number;
  low_stock_count: number;
  overstock_count: number;
  dead_stock_count: number;
  fast_movers_count: number;
  slow_movers_count: number;
  total_inventory_value: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  return q.toString();
}

export function healthSummary(params: {
  window_days?: number;
  dead_days?: number;
  store_id?: string;
} = {}): Promise<InventoryHealthSummary> {
  return apiRequest({ path: `/inventory/intelligence/summary?${qs(params)}`, method: 'GET' });
}

export function stockAlerts(params: {
  category?: StockCategory[];
  store_id?: string;
  window_days?: number;
} = {}): Promise<StockAlertRow[]> {
  const q = new URLSearchParams();
  q.set('window_days', String(params.window_days ?? 30));
  if (params.store_id) q.set('store_id', params.store_id);
  (params.category ?? []).forEach((c) => q.append('category', c));
  return apiRequest({ path: `/inventory/intelligence/alerts?${q.toString()}`, method: 'GET' });
}

export function movementAnalysis(params: {
  window_days?: number;
  dead_days?: number;
  store_id?: string;
} = {}): Promise<MovementRow[]> {
  return apiRequest({ path: `/inventory/intelligence/movement?${qs(params)}`, method: 'GET' });
}

export function inventoryValue(store_id?: string): Promise<InventoryValueTotal> {
  return apiRequest({
    path: `/inventory/intelligence/value${store_id ? `?store_id=${store_id}` : ''}`,
    method: 'GET',
  });
}

export function inventoryAging(params: {
  store_id?: string;
  limit?: number;
} = {}): Promise<InventoryAgingRow[]> {
  return apiRequest({ path: `/inventory/intelligence/aging?${qs(params)}`, method: 'GET' });
}
