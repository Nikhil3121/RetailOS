import { API_V1, apiRequest } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
  year: 'Last 365 days',
};

export interface KPIWithDelta {
  current: string;
  previous: string;
  delta_absolute: string;
  delta_pct: string | null;
}

export interface DashboardKPIs {
  revenue: KPIWithDelta;
  tax_collected: KPIWithDelta;
  discounts_given: KPIWithDelta;
  net_revenue: KPIWithDelta;
  sales_count: KPIWithDelta;
  average_order_value: KPIWithDelta;
  unique_customers: KPIWithDelta;
  estimated_profit: KPIWithDelta;
  estimated_margin_pct: KPIWithDelta;
}

export interface HourlyBucket {
  hour: number;
  sales_count: number;
  gross_total: string;
}

export interface DailyPoint {
  day: string;
  sales_count: number;
  gross_total: string;
}

export interface PaymentMix {
  cash: string;
  card: string;
  upi: string;
  other: string;
}

export interface StoreComparisonRow {
  store_id: string;
  store_code: string;
  store_name: string;
  sales_count: number;
  gross_total: string;
  tax_total: string;
  average_order_value: string;
}

export interface ProductProfitRow {
  variant_id: string;
  sku: string;
  product_name: string;
  quantity_sold: string;
  revenue: string;
  estimated_cost: string;
  estimated_profit: string;
  estimated_margin_pct: string | null;
}

export interface DashboardPayload {
  period: Period;
  from_date: string;
  to_date: string;
  previous_from: string;
  previous_to: string;
  store_id: string | null;
  kpis: DashboardKPIs;
  hourly: HourlyBucket[];
  daily_trend: DailyPoint[];
  payment_mix: PaymentMix;
  top_products: ProductProfitRow[];
  store_comparison: StoreComparisonRow[];
}

export function fetchDashboard(params: {
  period?: Period;
  store_id?: string;
} = {}): Promise<DashboardPayload> {
  const qs = new URLSearchParams();
  qs.set('period', params.period ?? 'today');
  if (params.store_id) qs.set('store_id', params.store_id);
  return apiRequest({ path: `/dashboard?${qs.toString()}`, method: 'GET' });
}

export function fetchStoreComparison(period: Period = 'month'): Promise<StoreComparisonRow[]> {
  return apiRequest({ path: `/dashboard/store-comparison?period=${period}`, method: 'GET' });
}

export function fetchHourly(on_date: string, store_id?: string): Promise<HourlyBucket[]> {
  const qs = new URLSearchParams({ on_date });
  if (store_id) qs.set('store_id', store_id);
  return apiRequest({ path: `/dashboard/hourly?${qs.toString()}`, method: 'GET' });
}

export function fetchTopProducts(params: {
  period?: Period;
  store_id?: string;
  limit?: number;
} = {}): Promise<ProductProfitRow[]> {
  const qs = new URLSearchParams();
  qs.set('period', params.period ?? 'month');
  qs.set('limit', String(params.limit ?? 20));
  if (params.store_id) qs.set('store_id', params.store_id);
  return apiRequest({ path: `/dashboard/top-products?${qs.toString()}`, method: 'GET' });
}

/**
 * Trigger a browser file download for the sales CSV export.
 *
 * Uses fetch (not apiRequest) because the response is a blob, not JSON —
 * but re-uses the auth store token so it works exactly like every other call.
 */
export async function downloadSalesCsv(params: {
  from_date: string;
  to_date: string;
  store_id?: string;
}): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const qs = new URLSearchParams({ from_date: params.from_date, to_date: params.to_date });
  if (params.store_id) qs.set('store_id', params.store_id);

  const res = await fetch(`${API_V1}/dashboard/export/sales.csv?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sales-${params.from_date}-to-${params.to_date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
