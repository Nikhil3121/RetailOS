import { apiRequest } from '@/api/api';

export interface KPI {
  value: string;
  delta_absolute: string | null;
  delta_pct: string | null;
}

export interface DashboardSummary {
  from: string;
  to: string;
  revenue: KPI;
  sales_count: KPI;
  avg_order_value: KPI;
  unique_customers: KPI;
  est_profit: KPI;
  est_margin_pct: KPI;
  tax_collected: KPI;
  discounts_given: KPI;
}

export function getDashboardSummary(storeId?: string): Promise<DashboardSummary> {
  const qs = new URLSearchParams();
  if (storeId) qs.set('store_id', storeId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiRequest({ path: `/dashboard/summary${suffix}`, method: 'GET' });
}
