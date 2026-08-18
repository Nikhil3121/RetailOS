import { apiRequest } from '@/lib/api';
import type { SaleSummary } from '@/lib/sales-api';
import type { Paginated } from '@/lib/suppliers-api';

export interface BillingSummary {
  outstanding_bills: number;
  total_due: string;
  customers_with_due: number;
}

export function listOutstanding(params: {
  page?: number;
  page_size?: number;
  store_id?: string;
  customer_id?: string;
} = {}): Promise<Paginated<SaleSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.customer_id) qs.set('customer_id', params.customer_id);
  return apiRequest({ path: `/billing/outstanding?${qs.toString()}`, method: 'GET' });
}

export function billingSummary(storeId?: string): Promise<BillingSummary> {
  const qs = new URLSearchParams();
  if (storeId) qs.set('store_id', storeId);
  const q = qs.toString();
  return apiRequest({
    path: `/billing/summary${q ? `?${q}` : ''}`,
    method: 'GET',
  });
}
