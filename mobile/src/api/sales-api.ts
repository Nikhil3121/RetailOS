/** Sales endpoints. Create + list; per-sale detail comes later. */

import { apiRequest } from '@/api/api';
import type { Paginated } from '@/types/common';
import type { PaymentMethod, Sale, SaleCreate, SaleSummary } from '@/types/sale';

export interface ListSalesParams {
  page?: number;
  page_size?: number;
  store_id?: string;
  from?: string; // ISO date
  to?: string; // ISO date
}

export function listSales(params: ListSalesParams = {}): Promise<Paginated<SaleSummary>> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return apiRequest({ path: `/sales?${qs.toString()}`, method: 'GET' });
}

export function createSale(body: SaleCreate): Promise<Sale> {
  return apiRequest({ path: '/sales', method: 'POST', body });
}

export function getSale(id: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}`, method: 'GET' });
}

export function collectSalePayment(
  id: string,
  body: { method: PaymentMethod; amount: string; reference?: string | null },
): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/payments`, method: 'POST', body });
}

export function listOutstanding(page = 1, pageSize = 100): Promise<Paginated<SaleSummary>> {
  const qs = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    has_balance: 'true',
  });
  return apiRequest({ path: `/sales?${qs.toString()}`, method: 'GET' });
}
