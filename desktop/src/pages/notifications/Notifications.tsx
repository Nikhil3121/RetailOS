import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CheckCheck,
  Info,
} from 'lucide-react';

import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  CHANNEL_LABEL,
  KIND_LABEL,
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
  type NotificationSeverity,
} from '@/lib/notifications-api';

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  info: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  critical: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
};

const SEVERITY_ICON: Record<NotificationSeverity, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  critical: <AlertOctagon className="h-4 w-4" />,
};

export function Notifications(): JSX.Element {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState<string>('');

  const query = useQuery({
    queryKey: ['notifications', 'full', unreadOnly],
    queryFn: () =>
      listNotifications({
        page_size: 200,
        unread_only: unreadOnly === 'unread',
      }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'full'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'recent'] });
    },
  });
  const markAll = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'full'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'recent'] });
    },
  });

  const columns = useMemo<Column<Notification>[]>(
    () => [
      {
        key: 'title',
        header: 'Notification',
        cell: (n) => (
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                SEVERITY_TONE[n.severity],
              )}
            >
              {SEVERITY_ICON[n.severity]}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium text-white">{n.title}</div>
                {n.read_at === null && (
                  <span className="h-2 w-2 rounded-full bg-cobalt-400" title="Unread" />
                )}
              </div>
              {n.body && (
                <p className="mt-1 whitespace-pre-line text-xs text-slate-400">
                  {n.body}
                </p>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'kind',
        header: 'Kind',
        cell: (n) => (
          <span className="rounded-md border border-border bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-wider text-slate-300">
            {KIND_LABEL[n.kind]}
          </span>
        ),
      },
      {
        key: 'channels',
        header: 'Channels',
        cell: (n) => (
          <div className="flex flex-wrap gap-1">
            {n.channels.map((ch) => (
              <span
                key={ch}
                className="rounded-md border border-border bg-white/[0.02] px-2 py-1 text-xs text-slate-400"
              >
                {CHANNEL_LABEL[ch as keyof typeof CHANNEL_LABEL] ?? ch}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'when',
        header: 'When',
        cell: (n) => (
          <span className="text-xs text-slate-400">
            {new Date(n.created_at).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (n) =>
          n.read_at === null ? (
            <Button size="sm" variant="secondary" onClick={() => markOne.mutate(n.id)}>
              Mark read
            </Button>
          ) : (
            <span className="text-xs text-slate-500">
              read {new Date(n.read_at).toLocaleString()}
            </span>
          ),
      },
    ],
    [markOne],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Every notification for you and every broadcast to your role."
        actions={
          <Button
            variant="secondary"
            leadingIcon={<CheckCheck className="h-4 w-4" />}
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
          >
            Mark all read
          </Button>
        }
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[200px]">
          <Select
            options={[
              { label: 'All', value: '' },
              { label: 'Unread only', value: 'unread' },
            ]}
            value={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load notifications.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(n) => n.id}
        empty={
          query.isLoading
            ? 'Loading…'
            : unreadOnly === 'unread'
              ? 'Nothing unread — you are caught up.'
              : (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Bell className="h-6 w-6 text-slate-500" />
                  No notifications yet. Rules fire when their conditions match.
                </div>
              )
        }
      />
    </div>
  );
}
