import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  company_name: string | null;
  date_of_birth: string | null;
  anniversary: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreate {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  company_name?: string | null;
  date_of_birth?: string | null;
  anniversary?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string;
  notes?: string | null;
  is_active?: boolean;
}

export function listCustomers(
  page = 1, pageSize = 100, search?: string,
): Promise<Paginated<Customer>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search) qs.set('search', search);
  return apiRequest({ path: `/customers?${qs.toString()}`, method: 'GET' });
}

export function createCustomer(body: CustomerCreate): Promise<Customer> {
  return apiRequest({ path: '/customers', method: 'POST', body });
}
export function updateCustomer(id: string, body: Partial<CustomerCreate>): Promise<Customer> {
  return apiRequest({ path: `/customers/${id}`, method: 'PATCH', body });
}
export function deleteCustomer(id: string): Promise<void> {
  return apiRequest({ path: `/customers/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Timeline (M3)
// ---------------------------------------------------------------------------

export type TimelineKind = 'sale' | 'sale_voided' | 'coupon_redemption';

export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  title: string;
  subtitle: string | null;
  amount: string | null;
  reference: string | null;
  sale_id: string | null;
  coupon_id: string | null;
}

export interface TimelinePayload {
  customer_id: string;
  entries: TimelineEntry[];
}

export function customerTimeline(id: string, limit = 100): Promise<TimelinePayload> {
  return apiRequest({ path: `/customers/${id}/timeline?limit=${limit}`, method: 'GET' });
}

export function getCustomer(id: string): Promise<Customer> {
  return apiRequest({ path: `/customers/${id}`, method: 'GET' });
}
