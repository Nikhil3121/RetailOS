/**
 * Typed clients for every catalog resource. One file to keep imports short —
 * the surface stays manageable because most resources are pure CRUD.
 */
import { apiRequest } from '@/lib/api';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
export interface Unit {
  id: string;
  name: string;
  symbol: string;
  is_fractional: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface UnitCreate {
  name: string;
  symbol: string;
  is_fractional?: boolean;
  is_active?: boolean;
}
export function listUnits(page = 1, pageSize = 200): Promise<Paginated<Unit>> {
  return apiRequest({ path: `/units?page=${page}&page_size=${pageSize}`, method: 'GET' });
}
export function createUnit(body: UnitCreate): Promise<Unit> {
  return apiRequest({ path: '/units', method: 'POST', body });
}
export function updateUnit(id: string, body: Partial<UnitCreate>): Promise<Unit> {
  return apiRequest({ path: `/units/${id}`, method: 'PATCH', body });
}
export function deleteUnit(id: string): Promise<void> {
  return apiRequest({ path: `/units/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------
export interface Brand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface BrandCreate {
  name: string;
  slug?: string;
  description?: string | null;
  logo_url?: string | null;
  is_active?: boolean;
}
export function listBrands(page = 1, pageSize = 200): Promise<Paginated<Brand>> {
  return apiRequest({ path: `/brands?page=${page}&page_size=${pageSize}`, method: 'GET' });
}
export function createBrand(body: BrandCreate): Promise<Brand> {
  return apiRequest({ path: '/brands', method: 'POST', body });
}
export function updateBrand(id: string, body: Partial<BrandCreate>): Promise<Brand> {
  return apiRequest({ path: `/brands/${id}`, method: 'PATCH', body });
}
export function deleteBrand(id: string): Promise<void> {
  return apiRequest({ path: `/brands/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  children: CategoryTreeNode[];
}
export interface CategoryCreate {
  name: string;
  slug?: string;
  description?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}
export function listCategories(page = 1, pageSize = 200): Promise<Paginated<Category>> {
  return apiRequest({ path: `/categories?page=${page}&page_size=${pageSize}`, method: 'GET' });
}
export function categoryTree(): Promise<CategoryTreeNode[]> {
  return apiRequest({ path: '/categories/tree', method: 'GET' });
}
export function createCategory(body: CategoryCreate): Promise<Category> {
  return apiRequest({ path: '/categories', method: 'POST', body });
}
export function updateCategory(id: string, body: Partial<CategoryCreate>): Promise<Category> {
  return apiRequest({ path: `/categories/${id}`, method: 'PATCH', body });
}
export function deleteCategory(id: string): Promise<void> {
  return apiRequest({ path: `/categories/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface Variant {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, unknown>;
  cost_price: string;
  mrp: string;
  selling_price: string;
  reorder_point: string;
  reorder_quantity: string;
  overstock_point: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  hsn_code: string | null;
  tax_rate: string;
  brand_id: string | null;
  category_id: string | null;
  unit_id: string;
  is_active: boolean;
  variants: Variant[];
  images: ProductImage[];
  created_at: string;
  updated_at: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  hsn_code: string | null;
  tax_rate: string;
  brand_id: string | null;
  category_id: string | null;
  unit_id: string;
  is_active: boolean;
  variant_count: number;
  primary_sku: string | null;
  primary_selling_price: string | null;
  created_at: string;
  updated_at: string;
}

export interface VariantCreateBody {
  name: string;
  sku: string;
  barcode?: string | null;
  attributes?: Record<string, unknown>;
  cost_price?: string;
  mrp?: string;
  selling_price?: string;
  reorder_point?: string;
  reorder_quantity?: string;
  overstock_point?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface ImageCreateBody {
  url: string;
  alt_text?: string | null;
  sort_order?: number;
}

export interface ProductCreateBody {
  name: string;
  description?: string | null;
  hsn_code?: string | null;
  tax_rate?: string;
  brand_id?: string | null;
  category_id?: string | null;
  unit_id: string;
  is_active?: boolean;
  variants?: VariantCreateBody[];
  images?: ImageCreateBody[];
}

export interface ProductListParams {
  page?: number;
  page_size?: number;
  search?: string;
  category_id?: string;
  brand_id?: string;
  is_active?: boolean;
}

export function listProducts(params: ProductListParams = {}): Promise<Paginated<ProductSummary>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 50));
  if (params.search) qs.set('search', params.search);
  if (params.category_id) qs.set('category_id', params.category_id);
  if (params.brand_id) qs.set('brand_id', params.brand_id);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  return apiRequest({ path: `/products?${qs.toString()}`, method: 'GET' });
}

export function getProduct(id: string): Promise<Product> {
  return apiRequest({ path: `/products/${id}`, method: 'GET' });
}

export function createProduct(body: ProductCreateBody): Promise<Product> {
  return apiRequest({ path: '/products', method: 'POST', body });
}

export function updateProduct(id: string, body: Partial<ProductCreateBody>): Promise<Product> {
  return apiRequest({ path: `/products/${id}`, method: 'PATCH', body });
}

export function deleteProduct(id: string): Promise<void> {
  return apiRequest({ path: `/products/${id}`, method: 'DELETE' });
}

export function addVariant(productId: string, body: VariantCreateBody): Promise<Variant> {
  return apiRequest({ path: `/products/${productId}/variants`, method: 'POST', body });
}

export function updateVariant(variantId: string, body: Partial<VariantCreateBody>): Promise<Variant> {
  return apiRequest({ path: `/products/variants/${variantId}`, method: 'PATCH', body });
}

export function deleteVariant(variantId: string): Promise<void> {
  return apiRequest({ path: `/products/variants/${variantId}`, method: 'DELETE' });
}

export function addImage(productId: string, body: ImageCreateBody): Promise<ProductImage> {
  return apiRequest({ path: `/products/${productId}/images`, method: 'POST', body });
}

export function deleteImage(imageId: string): Promise<void> {
  return apiRequest({ path: `/products/images/${imageId}`, method: 'DELETE' });
}
