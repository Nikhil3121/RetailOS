import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type TargetPeriod = 'month' | 'quarter' | 'year';

export const TARGET_PERIOD_LABEL: Record<TargetPeriod, string> = {
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

export interface StaffPerformanceRow {
  user_id: string;
  user_name: string;
  role: string;
  store_id: string | null;
  sales_count: number;
  revenue: string;
  average_bill_value: string;
  voided_count: number;
  voided_amount: string;
}

export interface StaffPerformanceReport {
  from_date: string;
  to_date: string;
  store_id: string | null;
  rows: StaffPerformanceRow[];
}

export interface StaffTarget {
  id: string;
  user_id: string;
  period: TargetPeriod;
  period_start: string;
  target_amount: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffTargetCreate {
  user_id: string;
  period: TargetPeriod;
  period_start: string;
  target_amount: string;
  notes?: string | null;
}

export interface StaffTargetWithProgress {
  target: StaffTarget;
  achieved_amount: string;
  achievement_pct: string;
  remaining_amount: string;
}

export function staffPerformance(params: {
  from_date: string;
  to_date: string;
  store_id?: string;
}): Promise<StaffPerformanceReport> {
  // Build the query string ourselves: `new URLSearchParams(obj)` coerces
  // `undefined` to the literal string "undefined", so an omitted store_id
  // would hit the backend as `store_id=undefined` and fail UUID parsing.
  const qs = new URLSearchParams();
  qs.set('from_date', params.from_date);
  qs.set('to_date', params.to_date);
  if (params.store_id) qs.set('store_id', params.store_id);
  return apiRequest({ path: `/staff/performance?${qs.toString()}`, method: 'GET' });
}

export function listTargets(
  params: { user_id?: string; period?: TargetPeriod; page?: number; page_size?: number } = {},
): Promise<Paginated<StaffTarget>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 200));
  if (params.user_id) qs.set('user_id', params.user_id);
  if (params.period) qs.set('period', params.period);
  return apiRequest({ path: `/staff/targets?${qs.toString()}`, method: 'GET' });
}

export function createTarget(body: StaffTargetCreate): Promise<StaffTarget> {
  return apiRequest({ path: '/staff/targets', method: 'POST', body });
}
export function updateTarget(id: string, body: Partial<StaffTargetCreate>): Promise<StaffTarget> {
  return apiRequest({ path: `/staff/targets/${id}`, method: 'PATCH', body });
}
export function deleteTarget(id: string): Promise<void> {
  return apiRequest({ path: `/staff/targets/${id}`, method: 'DELETE' });
}
export function targetProgress(id: string): Promise<StaffTargetWithProgress> {
  return apiRequest({ path: `/staff/targets/${id}/progress`, method: 'GET' });
}
