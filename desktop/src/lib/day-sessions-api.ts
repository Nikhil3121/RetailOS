import { apiRequest } from '@/lib/api';

export type DayStatus = 'open' | 'closed';

export interface DaySession {
  id: string;
  store_id: string;
  status: DayStatus;
  opened_by_user_id: string | null;
  opened_at: string;
  opening_cash: string;
  closed_by_user_id: string | null;
  closed_at: string | null;
  counted_cash: string | null;
  expected_cash: string | null;
  cash_diff: string | null;
  /** Set when a late-arriving offline sale restated this shift after close.
   *  When present, expected_cash and cash_diff are NOT the figures produced
   *  at close — the before/after detail lives in the audit log. */
  restated_at: string | null;
  notes: string | null;
  created_at: string;
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

export function currentSession(storeId: string): Promise<DaySession | null> {
  return apiRequest({ path: `/day-sessions/current?store_id=${storeId}`, method: 'GET' });
}

/**
 * Recent sessions for a store, newest first.
 *
 * `currentSession` returns only the OPEN one, so a closed shift — including
 * one restated after close — is invisible to it. This is what the Day session
 * screen reads to show the last shift's reconciliation.
 */
export function recentSessions(storeId: string, limit = 5): Promise<DaySession[]> {
  return apiRequest({
    path: `/day-sessions?store_id=${storeId}&limit=${limit}`,
    method: 'GET',
  });
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

export function sessionSummary(id: string): Promise<DaySessionSummary> {
  return apiRequest({ path: `/day-sessions/${id}/summary`, method: 'GET' });
}
