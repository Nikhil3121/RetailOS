import { apiRequest } from '@/lib/api';

export interface Store {
  /** Free text printed under the totals on this branch's bills. */
  receipt_message: string | null;
  id: string;
  code: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoresPage {
  items: Store[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateStoreBody {
  receipt_message?: string | null;
  code: string;
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean;
}

export function listStores(page = 1, pageSize = 50): Promise<StoresPage> {
  return apiRequest<StoresPage>({
    path: `/stores?page=${page}&page_size=${pageSize}`,
    method: 'GET',
  });
}

export function createStore(body: CreateStoreBody): Promise<Store> {
  return apiRequest<Store>({ path: '/stores', method: 'POST', body });
}

export function updateStore(id: string, body: Partial<CreateStoreBody>): Promise<Store> {
  return apiRequest<Store>({ path: `/stores/${id}`, method: 'PATCH', body });
}

export function deleteStore(id: string): Promise<void> {
  return apiRequest<void>({ path: `/stores/${id}`, method: 'DELETE' });
}
