import { apiRequest } from '@/lib/api';

export interface PurchaseAnalyticsSummary {
  from_date: string;
  to_date: string;
  po_count: number;
  total_spend: string;
  completed_spend: string;
  cancelled_spend: string;
  unique_suppliers: number;
}

export interface PurchaseTrendPoint {
  day: string;
  po_count: number;
  total_spend: string;
}

export interface SupplierScorecard {
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  po_count: number;
  total_spend: string;
  completed_pos: number;
  cancelled_pos: number;
  avg_turnaround_days: string | null;
  last_order_at: string | null;
}

export interface PurchaseCostRow {
  variant_id: string;
  sku: string;
  product_name: string;
  total_units_ordered: string;
  total_units_received: string;
  total_cost: string;
  average_unit_cost: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  return q.toString();
}

export function purchaseSummary(params: {
  from_date?: string;
  to_date?: string;
} = {}): Promise<PurchaseAnalyticsSummary> {
  return apiRequest({ path: `/purchase-analytics/summary?${qs(params)}`, method: 'GET' });
}

export function purchaseTrend(params: {
  from_date?: string;
  to_date?: string;
} = {}): Promise<PurchaseTrendPoint[]> {
  return apiRequest({ path: `/purchase-analytics/trend?${qs(params)}`, method: 'GET' });
}

export function supplierScorecards(params: {
  from_date?: string;
  to_date?: string;
} = {}): Promise<SupplierScorecard[]> {
  return apiRequest({ path: `/purchase-analytics/suppliers?${qs(params)}`, method: 'GET' });
}

export function topPurchaseCost(params: {
  from_date?: string;
  to_date?: string;
  limit?: number;
} = {}): Promise<PurchaseCostRow[]> {
  return apiRequest({ path: `/purchase-analytics/top-cost?${qs(params)}`, method: 'GET' });
}
