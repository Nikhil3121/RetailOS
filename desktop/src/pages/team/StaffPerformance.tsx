import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Medal, TrendingUp } from 'lucide-react';

import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { staffPerformance, type StaffPerformanceRow } from '@/lib/staff-api';
import { listStores } from '@/lib/stores-api';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  staff: 'Staff',
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function StaffPerformance(): JSX.Element {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [fromDate, setFromDate] = useState<string>(iso(monthStart));
  const [toDate, setToDate] = useState<string>(iso(today));
  const [storeId, setStoreId] = useState<string>('');

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const query = useQuery({
    queryKey: ['staff-performance', fromDate, toDate, storeId],
    queryFn: () =>
      staffPerformance({
        from_date: fromDate,
        to_date: toDate,
        store_id: storeId || undefined,
      }),
  });

  const rows = useMemo(
    () => (query.data?.rows ?? []).filter((r) => r.sales_count > 0 || Number(r.revenue) > 0),
    [query.data],
  );

  const topRevenue = rows[0]?.revenue ?? '0';
  const totalRevenue = rows.reduce((acc, r) => acc + Number(r.revenue), 0);

  const columns = useMemo<Column<StaffPerformanceRow>[]>(
    () => [
      {
        key: 'rank',
        header: '',
        cell: (r) => {
          const rank = rows.findIndex((x) => x.user_id === r.user_id) + 1;
          if (rank === 1) return <Medal className="h-5 w-5 text-amber-300" />;
          if (rank === 2) return <Medal className="h-5 w-5 text-slate-300" />;
          if (rank === 3) return <Medal className="h-5 w-5 text-amber-600" />;
          return <span className="font-mono text-xs text-slate-500">{rank}</span>;
        },
      },
      {
        key: 'name',
        header: 'Staff',
        cell: (r) => (
          <div>
            <div className="font-medium text-white">{r.user_name}</div>
            <div className="text-xs text-slate-500">{ROLE_LABEL[r.role] ?? r.role}</div>
          </div>
        ),
      },
      {
        key: 'sales',
        header: 'Bills',
        align: 'right',
        cell: (r) => <span className="font-mono">{r.sales_count}</span>,
      },
      {
        key: 'revenue',
        header: 'Revenue',
        align: 'right',
        cell: (r) => {
          const pct = Number(topRevenue) > 0
            ? Math.round((Number(r.revenue) / Number(topRevenue)) * 100)
            : 0;
          return (
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-white">₹{r.revenue}</span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full bg-gradient-to-r from-cobalt-500 to-aurora-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        key: 'aov',
        header: 'AOV',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-300">₹{r.average_bill_value}</span>,
      },
      {
        key: 'voided',
        header: 'Voided',
        align: 'right',
        cell: (r) =>
          r.voided_count > 0 ? (
            <span className="font-mono text-rose-300">
              {r.voided_count} · ₹{r.voided_amount}
            </span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
    ],
    [rows, topRevenue],
  );

  const topStaff = rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff performance"
        description="Sales credited to each staff member in the selected window. Attribution uses the Salesperson set on the bill; when unset it falls back to the cashier who rang it up."
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <Select
            placeholder="— All stores —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`,
              value: s.id,
            }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load performance.'}
        </div>
      )}

      {topStaff && (
        <GlassCard>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/40 to-amber-600/20 text-amber-200">
              <Award className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider text-slate-500">Top performer</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-xl font-semibold text-white">{topStaff.user_name}</span>
                <span className="font-mono text-sm text-slate-400">
                  ₹{topStaff.revenue} across {topStaff.sales_count} bills
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-500">Team total</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-white">
                ₹{totalRevenue.toFixed(2)}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.user_id}
        empty={
          query.isLoading
            ? 'Loading…'
            : 'No sales attributed to anyone in this window. Ring some up through POS.'
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <TrendingUp className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
        Attribution:{' '}
        <code className="text-slate-300">Sale.salesperson_user_id</code> when set (from the Billing
        salesperson picker), else <code className="text-slate-300">Sale.created_by_user_id</code>{' '}
        (the cashier at the register). Working-hours / attendance land with the Phase 4 HR module.
      </div>
    </div>
  );
}
