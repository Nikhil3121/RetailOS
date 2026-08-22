import { apiRequest } from '@/api/api';

export type DayStatus = 'open' | 'closed';

export interface DaySession {
  id: string;
  store_id: string;
  status: DayStatus;
  opened_by_user_id: string | null;
  opened_at: string;
  opening_cash: string;
  closed_at: string | null;
  counted_cash: string | null;
  expected_cash: string | null;
  cash_diff: string | null;
  notes: string | null;
  created_at: string;
}

export function currentSession(storeId: string): Promise<DaySession | null> {
  return apiRequest({ path: `/day-sessions/current?store_id=${storeId}`, method: 'GET' });
}

export function openSession(body: {
  store_id: string;
  opening_cash?: string;
  notes?: string | null;
}): Promise<DaySession> {
  return apiRequest({ path: '/day-sessions/open', method: 'POST', body });
}

export function closeSession(
  id: string,
  body: { counted_cash: string; notes?: string | null },
): Promise<DaySession> {
  return apiRequest({ path: `/day-sessions/${id}/close`, method: 'POST', body });
}

export interface DaySessionSummary {
  session: DaySession;
  sales_count: number;
  sales_total: string;
  cash_sales_total: string;
  card_sales_total: string;
  upi_sales_total: string;
  other_sales_total: string;
  expected_cash: string;
}

export function sessionSummary(id: string): Promise<DaySessionSummary> {
  return apiRequest({ path: `/day-sessions/${id}/summary`, method: 'GET' });
}
