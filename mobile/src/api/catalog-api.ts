/**
 * Catalog + stores endpoints. Trimmed to what the mobile pilot needs
 * (list + get). Full CRUD lives on desktop; mobile will grow into it as
 * we add per-screen editors.
 */

import { apiRequest } from '@/api/api';
import type { Paginated } from '@/types/common';
import type { Product, ProductSummary } from '@/types/product';
import type { Store } from '@/types/store';

export interface ListProductsParams {
  page?: number;
  page_size?: number;
  search?: string;
  category_id?: string;
  brand_id?: string;
  is_active?: boolean;
}

export function listProducts(params: ListProductsParams = {}): Promise<Paginated<ProductSummary>> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  if (params.search) qs.set('search', params.search);
  if (params.category_id) qs.set('category_id', params.category_id);
  if (params.brand_id) qs.set('brand_id', params.brand_id);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return apiRequest({ path: `/products?${qs.toString()}`, method: 'GET' });
}

export function getProduct(id: string): Promise<Product> {
  return apiRequest({ path: `/products/${id}`, method: 'GET' });
}

export function listStores(page = 1, pageSize = 200): Promise<Paginated<Store>> {
  return apiRequest({ path: `/stores?page=${page}&page_size=${pageSize}`, method: 'GET' });
}
