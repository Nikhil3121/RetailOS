import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type POStatus = 'draft' | 'confirmed' | 'received' | 'cancelled';

export const PO_STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  received: 'Received',
  cancelled: 'Cancelled',
};

export interface POLine {
  id: string;
  purchase_order_id: string;
  variant_id: string;
  quantity: string;
  unit_cost: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  line_total: string;
  sort_order: number;
}

export interface POLineCreate {
  variant_id: string;
  quantity: string;
  unit_cost: string;
  tax_rate?: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier_id: string;
  store_id: string;
  status: POStatus;
  order_date: string;
  expected_date: string | null;
  received_at: string | null;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  notes: string | null;
  lines: POLine[];
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  supplier_id: string;
  store_id: string;
  status: POStatus;
  order_date: string;
  expected_date: string | null;
  grand_total: string;
  line_count: number;
  created_at: string;
}

export interface PurchaseOrderCreate {
  supplier_id: string;
  store_id: string;
  order_date: string;
  expected_date?: string | null;
  notes?: string | null;
  lines: POLineCreate[];
}

export interface PurchaseOrderUpdate {
  supplier_id?: string;
  expected_date?: string | null;
  notes?: string | null;
  lines?: POLineCreate[];
}

export function listPurchaseOrders(params: {
  page?: number;
  page_size?: number;
  status?: POStatus;
  supplier_id?: string;
  store_id?: string;
} = {}): Promise<Paginated<PurchaseOrderSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.status) qs.set('status', params.status);
  if (params.supplier_id) qs.set('supplier_id', params.supplier_id);
  if (params.store_id) qs.set('store_id', params.store_id);
  return apiRequest({ path: `/purchase-orders?${qs.toString()}`, method: 'GET' });
}

export function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({ path: `/purchase-orders/${id}`, method: 'GET' });
}
export function createPurchaseOrder(body: PurchaseOrderCreate): Promise<PurchaseOrder> {
  return apiRequest({ path: '/purchase-orders', method: 'POST', body });
}
export function updatePurchaseOrder(id: string, body: PurchaseOrderUpdate): Promise<PurchaseOrder> {
  return apiRequest({ path: `/purchase-orders/${id}`, method: 'PATCH', body });
}
export function confirmPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({ path: `/purchase-orders/${id}/confirm`, method: 'POST' });
}
export function receivePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({ path: `/purchase-orders/${id}/receive`, method: 'POST' });
}
export function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({ path: `/purchase-orders/${id}/cancel`, method: 'POST' });
}
