import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategoryCreate {
  code: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

export function listCategories(
  page = 1, pageSize = 200, is_active?: boolean,
): Promise<Paginated<ExpenseCategory>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (is_active !== undefined) qs.set('is_active', String(is_active));
  return apiRequest({ path: `/expenses/categories?${qs.toString()}`, method: 'GET' });
}
export function createCategory(body: ExpenseCategoryCreate): Promise<ExpenseCategory> {
  return apiRequest({ path: '/expenses/categories', method: 'POST', body });
}
export function updateCategory(
  id: string, body: Partial<ExpenseCategoryCreate>,
): Promise<ExpenseCategory> {
  return apiRequest({ path: `/expenses/categories/${id}`, method: 'PATCH', body });
}
export function deleteCategory(id: string): Promise<void> {
  return apiRequest({ path: `/expenses/categories/${id}`, method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface Expense {
  id: string;
  number: string;
  category_id: string;
  store_id: string | null;
  status: ExpenseStatus;
  expense_date: string;
  amount: string;
  tax_amount: string;
  grand_total: string;
  payment_method: string;
  vendor: string | null;
  reference: string | null;
  receipt_url: string | null;
  notes: string | null;
  submitted_by_user_id: string | null;
  submitted_at: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCreate {
  category_id: string;
  store_id?: string | null;
  expense_date: string;
  amount: string;
  tax_amount?: string;
  payment_method?: string;
  vendor?: string | null;
  reference?: string | null;
  receipt_url?: string | null;
  notes?: string | null;
  submit?: boolean;
}

export function listExpenses(params: {
  page?: number;
  page_size?: number;
  status?: ExpenseStatus;
  store_id?: string;
  category_id?: string;
  from_date?: string;
  to_date?: string;
} = {}): Promise<Paginated<Expense>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 200));
  if (params.status) qs.set('status', params.status);
  if (params.store_id) qs.set('store_id', params.store_id);
  if (params.category_id) qs.set('category_id', params.category_id);
  if (params.from_date) qs.set('from_date', params.from_date);
  if (params.to_date) qs.set('to_date', params.to_date);
  return apiRequest({ path: `/expenses?${qs.toString()}`, method: 'GET' });
}
export function createExpense(body: ExpenseCreate): Promise<Expense> {
  return apiRequest({ path: '/expenses', method: 'POST', body });
}
export function updateExpense(id: string, body: Partial<ExpenseCreate>): Promise<Expense> {
  return apiRequest({ path: `/expenses/${id}`, method: 'PATCH', body });
}
export function deleteExpense(id: string): Promise<void> {
  return apiRequest({ path: `/expenses/${id}`, method: 'DELETE' });
}
export function submitExpense(id: string): Promise<Expense> {
  return apiRequest({ path: `/expenses/${id}/submit`, method: 'POST' });
}
export function approveExpense(id: string): Promise<Expense> {
  return apiRequest({ path: `/expenses/${id}/approve`, method: 'POST' });
}
export function rejectExpense(id: string, reason: string): Promise<Expense> {
  return apiRequest({ path: `/expenses/${id}/reject`, method: 'POST', body: { reason } });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ExpenseSummary {
  from_date: string;
  to_date: string;
  store_id: string | null;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
  rejected_count: number;
  submitted_pending_total: string;
  approved_total: string;
}

export interface ExpenseByCategoryRow {
  category_id: string;
  category_code: string;
  category_name: string;
  approved_count: number;
  approved_total: string;
}

export interface ExpenseTrendPoint {
  day: string;
  approved_count: number;
  approved_total: string;
}

export interface PnLReport {
  from_date: string;
  to_date: string;
  store_id: string | null;
  revenue: string;
  discounts: string;
  tax_collected: string;
  net_revenue: string;
  cost_of_goods_sold: string;
  gross_profit: string;
  operating_expenses: string;
  net_profit: string;
  net_margin_pct: string | null;
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  return q.toString();
}

export function expenseSummary(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<ExpenseSummary> {
  return apiRequest({ path: `/expenses/reports/summary?${qs(params)}`, method: 'GET' });
}
export function expensesByCategory(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<ExpenseByCategoryRow[]> {
  return apiRequest({ path: `/expenses/reports/by-category?${qs(params)}`, method: 'GET' });
}
export function expenseTrend(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<ExpenseTrendPoint[]> {
  return apiRequest({ path: `/expenses/reports/trend?${qs(params)}`, method: 'GET' });
}
export function pnlReport(params: {
  from_date?: string;
  to_date?: string;
  store_id?: string;
} = {}): Promise<PnLReport> {
  return apiRequest({ path: `/expenses/reports/pnl?${qs(params)}`, method: 'GET' });
}
