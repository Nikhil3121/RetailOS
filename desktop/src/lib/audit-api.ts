import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  summary: string;
  changes: Record<string, unknown>;
  created_at: string;
}

export function listAuditLogs(params: {
  page?: number;
  page_size?: number;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  actor_user_id?: string;
  search?: string;
} = {}): Promise<Paginated<AuditLog>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 200));
  if (params.action) qs.set('action', params.action);
  if (params.entity_type) qs.set('entity_type', params.entity_type);
  if (params.entity_id) qs.set('entity_id', params.entity_id);
  if (params.actor_user_id) qs.set('actor_user_id', params.actor_user_id);
  if (params.search) qs.set('search', params.search);
  return apiRequest({ path: `/audit-logs?${qs.toString()}`, method: 'GET' });
}

// ---------------------------------------------------------------------------
// Dashboard layout
// ---------------------------------------------------------------------------

export interface DashboardLayout {
  layout: {
    hidden?: string[];
    order?: string[];
    [key: string]: unknown;
  };
}

export function getLayout(): Promise<DashboardLayout> {
  return apiRequest({ path: '/dashboard-layout', method: 'GET' });
}

export function saveLayout(layout: DashboardLayout['layout']): Promise<DashboardLayout> {
  return apiRequest({ path: '/dashboard-layout', method: 'PUT', body: { layout } });
}
