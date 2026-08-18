import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type NotificationKind =
  | 'low_stock'
  | 'out_of_stock'
  | 'pending_day_close'
  | 'daily_summary'
  | 'commission_ready'
  | 'expense_submitted'
  | 'expense_approved'
  | 'custom';

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationChannel = 'in_app' | 'email' | 'whatsapp' | 'push';

export const KIND_LABEL: Record<NotificationKind, string> = {
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  pending_day_close: 'Pending day close',
  daily_summary: 'Daily summary',
  commission_ready: 'Commission ready',
  expense_submitted: 'Expense submitted',
  expense_approved: 'Expense approved',
  custom: 'Custom',
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  email: 'Email',
  whatsapp: 'WhatsApp',
  push: 'Push',
};

export interface Notification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  recipient_user_id: string | null;
  channels: string[];
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationCreate {
  kind?: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  recipient_user_id?: string | null;
  channels?: NotificationChannel[];
  metadata?: Record<string, unknown>;
}

export function listNotifications(params: {
  page?: number;
  page_size?: number;
  unread_only?: boolean;
} = {}): Promise<Paginated<Notification>> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 100));
  if (params.unread_only) qs.set('unread_only', 'true');
  return apiRequest({ path: `/notifications?${qs.toString()}`, method: 'GET' });
}

export function unreadCount(): Promise<{ unread: number }> {
  return apiRequest({ path: '/notifications/unread-count', method: 'GET' });
}

export function markRead(id: string): Promise<Notification> {
  return apiRequest({ path: `/notifications/${id}/read`, method: 'POST' });
}

export function markAllRead(): Promise<{ unread: number }> {
  return apiRequest({ path: '/notifications/read-all', method: 'POST' });
}

export function publishNotification(body: NotificationCreate): Promise<Notification> {
  return apiRequest({ path: '/notifications', method: 'POST', body });
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface NotificationRule {
  id: string;
  kind: NotificationKind;
  name: string;
  description: string | null;
  is_active: boolean;
  channels: string[];
  target_user_id: string | null;
  target_role: string | null;
  min_severity: NotificationSeverity;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NotificationRuleCreate {
  kind: NotificationKind;
  name: string;
  description?: string | null;
  is_active?: boolean;
  channels?: NotificationChannel[];
  target_user_id?: string | null;
  target_role?: string | null;
  min_severity?: NotificationSeverity;
  config?: Record<string, unknown>;
}

export function listRules(): Promise<NotificationRule[]> {
  return apiRequest({ path: '/notifications/rules', method: 'GET' });
}

export function createRule(body: NotificationRuleCreate): Promise<NotificationRule> {
  return apiRequest({ path: '/notifications/rules', method: 'POST', body });
}

export function updateRule(
  id: string, body: Partial<NotificationRuleCreate>,
): Promise<NotificationRule> {
  return apiRequest({ path: `/notifications/rules/${id}`, method: 'PATCH', body });
}

export function deleteRule(id: string): Promise<void> {
  return apiRequest({ path: `/notifications/rules/${id}`, method: 'DELETE' });
}
