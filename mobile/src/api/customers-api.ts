import { apiRequest } from '@/api/api';
import type { Paginated } from '@/types/common';
import type { Customer, CustomerCreate } from '@/types/customer';

export function listCustomers(page = 1, pageSize = 200, search?: string): Promise<Paginated<Customer>> {
  const qs = new URLSearchParams();
  qs.set('page', String(page));
  qs.set('page_size', String(pageSize));
  if (search) qs.set('search', search);
  return apiRequest({ path: `/customers?${qs.toString()}`, method: 'GET' });
}

export function getCustomer(id: string): Promise<Customer> {
  return apiRequest({ path: `/customers/${id}`, method: 'GET' });
}

export function createCustomer(body: CustomerCreate): Promise<Customer> {
  return apiRequest({ path: '/customers', method: 'POST', body });
}

export function updateCustomer(id: string, body: Partial<CustomerCreate>): Promise<Customer> {
  return apiRequest({ path: `/customers/${id}`, method: 'PATCH', body });
}
