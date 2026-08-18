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
