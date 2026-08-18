import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Info, Layers } from 'lucide-react';

import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  calculateCommissions,
  commissionBreakdown,
  type CommissionLine,
  type StaffCommissionSummary,
} from '@/lib/commissions-api';
import { listUsers } from '@/lib/users-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function Commissions(): JSX.Element {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [fromDate, setFromDate] = useState<string>(iso(monthStart));
  const [toDate, setToDate] = useState<string>(iso(today));
  const [userId, setUserId] = useState<string>('');
  const [showBreakdown, setShowBreakdown] = useState(false);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 200) });

  const summaryQuery = useQuery({
    queryKey: ['commissions', fromDate, toDate, userId],
    queryFn: () =>
      calculateCommissions({
        from_date: fromDate,
        to_date: toDate,
        user_id: userId || undefined,
      }),
  });

  const breakdownQuery = useQuery({
    queryKey: ['commissions', 'breakdown', fromDate, toDate, userId],
    queryFn: () =>
      commissionBreakdown({
        from_date: fromDate,
        to_date: toDate,
        user_id: userId || undefined,
      }),
    enabled: showBreakdown,
  });

  const summaryColumns = useMemo<Column<StaffCommissionSummary>[]>(
    () => [
      {
        key: 'user',
        header: 'Staff',
        cell: (r) => <span className="font-medium text-white">{r.user_name}</span>,
      },
      { key: 'lines', header: 'Lines', align: 'right', cell: (r) => <span className="font-mono">{r.line_count}</span> },
      { key: 'revenue', header: 'Revenue', align: 'right', cell: (r) => <span className="font-mono text-slate-100">₹{r.total_revenue}</span> },
      {
        key: 'commission',
        header: 'Commission',
        align: 'right',
        cell: (r) => <span className="font-mono font-semibold text-emerald-300">₹{r.total_commission}</span>,
      },
      {
        key: 'rate',
        header: 'Avg rate',
        align: 'right',
        cell: (r) => {
          const rev = Number(r.total_revenue);
          const com = Number(r.total_commission);
          return (
            <span className="font-mono text-slate-400">
              {rev > 0 ? `${((com / rev) * 100).toFixed(2)}%` : '—'}
            </span>
          );
        },
      },
    ],
    [],
  );

  const breakdownColumns = useMemo<Column<CommissionLine>[]>(
    () => [
      {
        key: 'invoice',
        header: 'Invoice',
        cell: (r) => <span className="font-mono text-xs text-slate-300">{r.sale_number}</span>,
      },
      {
        key: 'product',
        header: 'Product',
        cell: (r) => (
          <div>
            <div className="text-slate-100">{r.product_name}</div>
            <div className="font-mono text-xs text-slate-500">{r.sku}</div>
          </div>
        ),
      },
      { key: 'qty', header: 'Qty', align: 'right', cell: (r) => <span className="font-mono">{r.quantity}</span> },
      { key: 'line', header: 'Line total', align: 'right', cell: (r) => <span className="font-mono text-slate-100">₹{r.line_total}</span> },
      {
        key: 'rule',
        header: 'Applied rule',
        cell: (r) =>
          r.rule_name ? (
            <div>
              <div className="text-slate-200">{r.rule_name}</div>
              <div className="text-xs text-slate-500">
                {r.commission_type === 'percentage' ? `${r.rate}%` : `₹${r.rate} × qty`}
              </div>
            </div>
          ) : (
            <span className="text-slate-500">No matching rule</span>
          ),
      },
      {
        key: 'commission',
        header: 'Commission',
        align: 'right',
        cell: (r) => (
          <span
            className={
              Number(r.commission_amount) > 0
                ? 'font-mono font-semibold text-emerald-300'
                : 'font-mono text-slate-500'
            }
          >
            ₹{r.commission_amount}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        description="Rolls up commission per staff for the selected window using the currently active rules."
      />

      <div className="glass flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <Select
            placeholder="— All staff —"
            options={(usersQuery.data?.items ?? []).map((u) => ({
              label: u.full_name,
              value: u.id,
            }))}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
      </div>

      {summaryQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {summaryQuery.error instanceof ApiError ? summaryQuery.error.message : 'Failed to calculate.'}
        </div>
      )}

      <GlassCard>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/40 to-emerald-600/20 text-emerald-200">
              <Coins className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Total commission payable</div>
              <div className="mt-1 font-mono text-3xl font-semibold text-white">
                ₹{summaryQuery.data?.grand_total ?? '0.00'}
              </div>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            {summaryQuery.data && (
              <>
                {summaryQuery.data.per_staff.length} staff · {fromDate} → {toDate}
              </>
            )}
          </div>
        </div>
      </GlassCard>

      <DataTable
        columns={summaryColumns}
        rows={summaryQuery.data?.per_staff ?? []}
        rowKey={(r) => r.user_id}
        empty={summaryQuery.isLoading ? 'Calculating…' : 'No commission in this window.'}
      />

      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          className="flex items-center gap-2 text-sm text-cobalt-300 hover:text-cobalt-200"
        >
          <Layers className="h-4 w-4" />
          {showBreakdown ? 'Hide' : 'Show'} per-line breakdown
        </button>
      </div>

      {showBreakdown && (
        <>
          <DataTable
            columns={breakdownColumns}
            rows={breakdownQuery.data ?? []}
            rowKey={(r) => r.sale_line_id}
            empty={breakdownQuery.isLoading ? 'Loading…' : 'No lines.'}
          />
          <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            "No matching rule" means no active rule applied to that line — either no rule targets
            the product's category / brand, or every candidate rule was outside its effective window.
          </div>
        </>
      )}
    </div>
  );
}
