/**
 * Product + variant DTOs — mirror desktop's ProductSummary / ProductRead so
 * responses from /api/v1/products deserialize identically. All money and
 * quantity fields arrive as strings (Decimal on the backend) — parse with
 * Number() only at display time to avoid float rounding.
 */

export interface ProductVariant {
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
  variants: ProductVariant[];
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
