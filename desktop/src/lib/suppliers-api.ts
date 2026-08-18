import { apiRequest } from '@/lib/api';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
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

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface SupplierCreate {
  code: string;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string;
  notes?: string | null;
  is_active?: boolean;
}

export function listSuppliers(
  page = 1, pageSize = 100, search?: string,
): Promise<Paginated<Supplier>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (search) qs.set('search', search);
  return apiRequest({ path: `/suppliers?${qs.toString()}`, method: 'GET' });
}

export function createSupplier(body: SupplierCreate): Promise<Supplier> {
  return apiRequest({ path: '/suppliers', method: 'POST', body });
}
export function updateSupplier(id: string, body: Partial<SupplierCreate>): Promise<Supplier> {
  return apiRequest({ path: `/suppliers/${id}`, method: 'PATCH', body });
}
export function deleteSupplier(id: string): Promise<void> {
  return apiRequest({ path: `/suppliers/${id}`, method: 'DELETE' });
}
