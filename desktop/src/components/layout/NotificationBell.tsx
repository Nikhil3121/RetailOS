import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, Bell, CheckCheck, Info } from 'lucide-react';

import { cn } from '@/lib/cn';
import {
  KIND_LABEL,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type Notification,
  type NotificationSeverity,
} from '@/lib/notifications-api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Bell icon that lives in the app title bar.
 *
 * - Polls `/notifications/unread-count` every 20s (light query — a `SELECT count`).
 * - Opens a dropdown showing the last 20 notifications.
 * - Clicking a row marks it read + navigates to the full inbox if the user
 *   wants more context.
 */
export function NotificationBell(): JSX.Element | null {
  const isAuthed = useAuthStore((s) => s.status === 'authenticated');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const countQuery = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: unreadCount,
    enabled: isAuthed,
    refetchInterval: 20_000,
  });

  const listQuery = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => listNotifications({ page_size: 20 }),
    enabled: isAuthed && open,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'recent'] });
    },
  });
  const markAll = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'recent'] });
    },
  });

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!isAuthed) return null;

  const unread = countQuery.data?.unread ?? 0;

  return (
    <div ref={ref} className="titlebar-no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white/[0.03] text-slate-300 transition-colors hover:bg-white/[0.06]',
          open && 'bg-white/[0.06] border-border-strong',
        )}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-96 overflow-hidden rounded-xl border border-border-strong bg-ink-900/95 shadow-glass-lg backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Notifications</div>
              <div className="text-xs text-slate-500">
                {unread > 0 ? `${unread} unread` : 'All caught up'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 rounded-md border border-border bg-white/[0.03] px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.06]"
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {listQuery.isLoading && (
              <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
            )}
            {listQuery.data && listQuery.data.items.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                Nothing here yet.
              </div>
            )}
            {listQuery.data?.items.map((n) => (
              <BellRow
                key={n.id}
                notification={n}
                onClick={() => {
                  if (!n.read_at) markOne.mutate(n.id);
                }}
              />
            ))}
          </div>

          <div className="border-t border-border/70 px-4 py-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200"
            >
              Open full inbox →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SEVERITY_META: Record<
  NotificationSeverity,
  { icon: React.ReactNode; tone: string }
> = {
  info: { icon: <Info className="h-4 w-4" />, tone: 'text-cobalt-300 bg-cobalt-500/10 border-cobalt-500/30' },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  critical: { icon: <AlertOctagon className="h-4 w-4" />, tone: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
};

function BellRow({
  notification, onClick,
}: {
  notification: Notification;
  onClick: () => void;
}): JSX.Element {
  const meta = SEVERITY_META[notification.severity];
  const isUnread = notification.read_at === null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-b-0',
        isUnread ? 'bg-white/[0.02] hover:bg-white/[0.05]' : 'hover:bg-white/[0.03]',
      )}
    >
      <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border', meta.tone)}>
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-sm font-medium text-white">{notification.title}</div>
          {isUnread && (
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-cobalt-400" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-slate-400">
            {notification.body}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
          <span>{KIND_LABEL[notification.kind]}</span>
          <span>·</span>
          <span>{new Date(notification.created_at).toLocaleString()}</span>
        </div>
      </div>
    </button>
  );
}
