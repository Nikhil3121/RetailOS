import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type CommissionScope = 'global' | 'product' | 'category' | 'brand';
export type CommissionType = 'percentage' | 'fixed';

export const SCOPE_LABEL: Record<CommissionScope, string> = {
  global: 'Global',
  product: 'Product',
  category: 'Category',
  brand: 'Brand',
};

export const TYPE_LABEL: Record<CommissionType, string> = {
  percentage: 'Percentage',
  fixed: 'Fixed ₹/unit',
};

export interface CommissionRule {
  id: string;
  name: string;
  description: string | null;
  scope: CommissionScope;
  commission_type: CommissionType;
  rate: string;
  priority: number;
  product_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  staff_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommissionRuleCreate {
  name: string;
  description?: string | null;
  scope: CommissionScope;
  commission_type: CommissionType;
  rate: string;
  priority?: number;
  product_id?: string | null;
  category_id?: string | null;
  brand_id?: string | null;
  staff_id?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  is_active?: boolean;
}

export interface StaffCommissionSummary {
  user_id: string;
  user_name: string;
  from_date: string;
  to_date: string;
  total_revenue: string;
  total_commission: string;
  line_count: number;
}

export interface CommissionRunResult {
  from_date: string;
  to_date: string;
  per_staff: StaffCommissionSummary[];
  grand_total: string;
}

export interface CommissionLine {
  sale_id: string;
  sale_number: string;
  sale_line_id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  quantity: string;
  line_total: string;
  rule_id: string | null;
  rule_name: string | null;
  commission_type: CommissionType | null;
  rate: string | null;
  commission_amount: string;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function listRules(
  page = 1, pageSize = 200,
): Promise<Paginated<CommissionRule>> {
  return apiRequest({
    path: `/commissions/rules?page=${page}&page_size=${pageSize}`,
    method: 'GET',
  });
}
export function createRule(body: CommissionRuleCreate): Promise<CommissionRule> {
  return apiRequest({ path: '/commissions/rules', method: 'POST', body });
}
export function updateRule(id: string, body: Partial<CommissionRuleCreate>): Promise<CommissionRule> {
  return apiRequest({ path: `/commissions/rules/${id}`, method: 'PATCH', body });
}
export function deleteRule(id: string): Promise<void> {
  return apiRequest({ path: `/commissions/rules/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

function buildDateParams(params: {
  from_date: string;
  to_date: string;
  user_id?: string;
}): URLSearchParams {
  // Manual build — see staff-api.ts for the URLSearchParams(undefined) trap.
  const qs = new URLSearchParams();
  qs.set('from_date', params.from_date);
  qs.set('to_date', params.to_date);
  if (params.user_id) qs.set('user_id', params.user_id);
  return qs;
}

export function calculateCommissions(params: {
  from_date: string;
  to_date: string;
  user_id?: string;
}): Promise<CommissionRunResult> {
  return apiRequest({
    path: `/commissions/calculate?${buildDateParams(params).toString()}`,
    method: 'GET',
  });
}

export function commissionBreakdown(params: {
  from_date: string;
  to_date: string;
  user_id?: string;
}): Promise<CommissionLine[]> {
  return apiRequest({
    path: `/commissions/breakdown?${buildDateParams(params).toString()}`,
    method: 'GET',
  });
}
