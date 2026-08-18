import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type SaleStatus = 'completed' | 'voided';
export type PaymentMethod = 'cash' | 'card' | 'upi' | 'other';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  other: 'Other',
};

export interface SaleLine {
  id: string;
  sale_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  hsn_code: string | null;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  discount_amount: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  line_total: string;
  sort_order: number;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  number: string;
  store_id: string;
  day_session_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  status: SaleStatus;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  paid_total: string;
  change_due: string;
  balance_due: string;
  notes: string | null;
  completed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_user_id: string | null;
  lines: SaleLine[];
  payments: SalePayment[];
  created_at: string;
}

export interface SaleSummary {
  id: string;
  number: string;
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  status: SaleStatus;
  grand_total: string;
  paid_total: string;
  balance_due: string;
  line_count: number;
  completed_at: string | null;
  created_at: string;
}

export interface SaleLineInput {
  variant_id: string;
  quantity: string;
  unit_price?: string | null;
  discount_pct?: string;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: string;
  reference?: string | null;
}

export interface SaleCreate {
  store_id: string;
  customer_id?: string | null;
  /** Staff credited with the sale. Server falls back to the cashier if omitted. */
  salesperson_user_id?: string | null;
  lines: SaleLineInput[];
  /** Empty array = pure credit bill; whole grand total becomes balance_due. */
  payments: SalePaymentInput[];
  notes?: string | null;
  /** Idempotency key for offline replay. Same UUID on every retry = one sale. */
  client_uuid?: string | null;
}

export interface SalePaymentCollect {
  method: PaymentMethod;
  amount: string;
  reference?: string | null;
}

export function listSales(params: {
  page?: number;
  page_size?: number;
  store_id?: string;
  status?: SaleStatus;
  from_date?: string;
  to_date?: string;
} = {}): Promise<Paginated<SaleSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.status) qs.set('status', params.status);
  if (params.from_date) qs.set('from_date', params.from_date);
  if (params.to_date) qs.set('to_date', params.to_date);
  return apiRequest({ path: `/sales?${qs.toString()}`, method: 'GET' });
}

export function getSale(id: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}`, method: 'GET' });
}

export function createSale(body: SaleCreate): Promise<Sale> {
  return apiRequest({ path: '/sales', method: 'POST', body });
}

export function voidSale(id: string, reason: string): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/void`, method: 'POST', body: { reason } });
}

export function collectSalePayment(
  id: string,
  body: SalePaymentCollect,
): Promise<Sale> {
  return apiRequest({ path: `/sales/${id}/payments`, method: 'POST', body });
}
