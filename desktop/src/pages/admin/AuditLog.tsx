import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Info, Search } from 'lucide-react';

import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { listAuditLogs, type AuditLog } from '@/lib/audit-api';
import { listUsers } from '@/lib/users-api';

const ACTION_TONE: Record<string, string> = {
  create: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  update: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
  delete: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  approve: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  reject: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  void: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  login: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
  logout: 'border-border bg-white/[0.03] text-slate-300',
};

function toneFor(action: string): string {
  const verb = action.split('.').pop() ?? '';
  return ACTION_TONE[verb] ?? 'border-border bg-white/[0.03] text-slate-300';
}

const ENTITY_OPTIONS = [
  { label: '— All entities —', value: '' },
  { label: 'User', value: 'user' },
  { label: 'Sale', value: 'sale' },
  { label: 'Expense', value: 'expense' },
];

export function AuditLog(): JSX.Element {
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState<string>('');
  const [actorId, setActorId] = useState<string>('');

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 200) });

  const query = useQuery({
    queryKey: ['audit-logs', search, entityType, actorId],
    queryFn: () =>
      listAuditLogs({
        search: search.trim() || undefined,
        entity_type: entityType || undefined,
        actor_user_id: actorId || undefined,
        page_size: 200,
      }),
    refetchInterval: 30_000,
  });

  const columns = useMemo<Column<AuditLog>[]>(
    () => [
      {
        key: 'when',
        header: 'When',
        cell: (r) => (
          <div className="text-xs text-slate-300">
            {new Date(r.created_at).toLocaleString()}
          </div>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        cell: (r) => (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-xs ${toneFor(r.action)}`}
          >
            {r.action}
          </span>
        ),
      },
      {
        key: 'summary',
        header: 'Summary',
        cell: (r) => (
          <div>
            <div className="text-slate-100">{r.summary}</div>
            {Object.keys(r.changes).length > 0 && (
              <details className="mt-1 text-xs text-slate-500">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                  changes ({Object.keys(r.changes).length})
                </summary>
                <pre className="mt-1 overflow-auto rounded-md border border-border bg-white/[0.02] p-2 text-xs text-slate-300">
                  {JSON.stringify(r.changes, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ),
      },
      {
        key: 'actor',
        header: 'Actor',
        cell: (r) => (
          <div>
            <div className="text-slate-200">{r.actor_email ?? <span className="text-slate-500">system</span>}</div>
            {r.ip_address && (
              <div className="font-mono text-xs text-slate-500">{r.ip_address}</div>
            )}
          </div>
        ),
      },
      {
        key: 'entity',
        header: 'Entity',
        cell: (r) =>
          r.entity_type ? (
            <div>
              <div className="text-xs text-slate-300">{r.entity_type}</div>
              {r.entity_id && (
                <div className="font-mono text-xs text-slate-500">
                  {r.entity_id.slice(0, 8)}
                </div>
              )}
            </div>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every meaningful mutation, immutable and append-only. Auto-refreshes every 30 seconds."
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[240px] flex-1">
          <Input
            placeholder="Search summary, action, actor email"
            leadingIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="min-w-[180px]">
          <Select
            options={ENTITY_OPTIONS}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
        </div>
        <div className="min-w-[200px]">
          <Select
            placeholder="— All actors —"
            options={(usersQuery.data?.items ?? []).map((u) => ({
              label: u.full_name,
              value: u.id,
            }))}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load audit log.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(r) => r.id}
        empty={
          query.isLoading ? (
            'Loading…'
          ) : (
            <div className="flex flex-col items-center gap-2 py-4">
              <History className="h-6 w-6 text-slate-500" />
              <div>No matching audit entries.</div>
            </div>
          )
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <Info className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          Audit covers login/logout, sale create/void, expense approve/reject, and
          user create/update/delete. To extend to catalog / inventory / PO changes,
          add <code className="text-slate-300">AuditService.log(...)</code> calls
          at those endpoint boundaries.
        </span>
      </div>
    </div>
  );
}
