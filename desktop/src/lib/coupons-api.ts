import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type CouponDiscountType = 'percentage' | 'flat';

export const COUPON_TYPE_LABEL: Record<CouponDiscountType, string> = {
  percentage: 'Percentage',
  flat: 'Flat ₹',
};

export interface Coupon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: string;
  max_discount_amount: string | null;
  min_bill_amount: string;
  max_uses_total: number | null;
  max_uses_per_customer: number | null;
  uses_count: number;
  valid_from: string | null;
  valid_to: string | null;
  customer_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CouponCreate {
  code: string;
  name: string;
  description?: string | null;
  discount_type: CouponDiscountType;
  discount_value: string;
  max_discount_amount?: string | null;
  min_bill_amount?: string;
  max_uses_total?: number | null;
  max_uses_per_customer?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  customer_id?: string | null;
  is_active?: boolean;
}

export interface CouponValidateResponse {
  valid: boolean;
  reason: string | null;
  coupon: Coupon | null;
  computed_discount: string;
  final_amount: string;
}

export function listCoupons(
  page = 1, pageSize = 100, is_active?: boolean,
): Promise<Paginated<Coupon>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (is_active !== undefined) qs.set('is_active', String(is_active));
  return apiRequest({ path: `/coupons?${qs.toString()}`, method: 'GET' });
}
export function createCoupon(body: CouponCreate): Promise<Coupon> {
  return apiRequest({ path: '/coupons', method: 'POST', body });
}
export function updateCoupon(id: string, body: Partial<CouponCreate>): Promise<Coupon> {
  return apiRequest({ path: `/coupons/${id}`, method: 'PATCH', body });
}
export function deleteCoupon(id: string): Promise<void> {
  return apiRequest({ path: `/coupons/${id}`, method: 'DELETE' });
}
export function validateCoupon(body: {
  code: string;
  bill_amount: string;
  customer_id?: string;
}): Promise<CouponValidateResponse> {
  return apiRequest({ path: '/coupons/validate', method: 'POST', body });
}
