import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Coins,
  IndianRupee,
  Percent,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet2,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { KpiCard } from '@/components/bi/KpiCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  expenseSummary,
  expenseTrend,
  expensesByCategory,
  pnlReport,
  type ExpenseByCategoryRow,
} from '@/lib/expenses-api';
import { listStores } from '@/lib/stores-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function ExpenseReports(): JSX.Element {
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 29);

  const [fromDate, setFromDate] = useState<string>(iso(monthAgo));
  const [toDate, setToDate] = useState<string>(iso(today));
  const [storeId, setStoreId] = useState<string>('');

  const params = {
    from_date: fromDate,
    to_date: toDate,
    store_id: storeId || undefined,
  };

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const summaryQuery = useQuery({
    queryKey: ['expense-summary', params],
    queryFn: () => expenseSummary(params),
  });
  const byCategoryQuery = useQuery({
    queryKey: ['expense-by-category', params],
    queryFn: () => expensesByCategory(params),
  });
  const trendQuery = useQuery({
    queryKey: ['expense-trend', params],
    queryFn: () => expenseTrend(params),
  });
  const pnlQuery = useQuery({
    queryKey: ['pnl', params],
    queryFn: () => pnlReport(params),
  });

  const s = summaryQuery.data;
  const pnl = pnlQuery.data;
  const totalCategoryApproved = (byCategoryQuery.data ?? []).reduce(
    (acc, r) => acc + Number(r.approved_total),
    0,
  );

  const categoryColumns = useMemo<Column<ExpenseByCategoryRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Category',
        cell: (r) => (
          <div>
            <div className="font-medium text-white">{r.category_name}</div>
            <div className="font-mono text-xs text-slate-500">{r.category_code}</div>
          </div>
        ),
      },
      { key: 'count', header: 'Approved', align: 'right', cell: (r) => <span className="font-mono">{r.approved_count}</span> },
      {
        key: 'total',
        header: 'Total',
        align: 'right',
        cell: (r) => {
          const pct = totalCategoryApproved > 0
            ? Math.round((Number(r.approved_total) / totalCategoryApproved) * 100)
            : 0;
          return (
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-white">₹{r.approved_total}</span>
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
    ],
    [totalCategoryApproved],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense reports & P&L"
        description="Revenue minus COGS minus operating expenses. Only APPROVED expenses count."
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

      {pnlQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {pnlQuery.error instanceof ApiError ? pnlQuery.error.message : 'Failed to load.'}
        </div>
      )}

      {/* P&L headline */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Net revenue"
          value={pnl ? `₹${pnl.net_revenue}` : '—'}
          hint="After discounts, before tax"
          icon={IndianRupee}
          accent="cobalt"
        />
        <KpiCard
          label="Gross profit"
          value={pnl ? `₹${pnl.gross_profit}` : '—'}
          hint="Revenue − COGS"
          icon={TrendingUp}
          accent="aurora"
        />
        <KpiCard
          label="Operating expenses"
          value={pnl ? `₹${pnl.operating_expenses}` : '—'}
          hint="Approved only"
          icon={Wallet2}
        />
        <KpiCard
          label="Net profit"
          value={pnl ? `₹${pnl.net_profit}` : '—'}
          hint={pnl?.net_margin_pct ? `${pnl.net_margin_pct}% margin` : undefined}
          icon={Number(pnl?.net_profit ?? '0') >= 0 ? TrendingUp : TrendingDown}
          accent={Number(pnl?.net_profit ?? '0') >= 0 ? 'emerald' : 'slate'}
        />
      </section>

      {/* Expense status pills */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatusPill label="Draft" count={s?.draft_count ?? 0} tone="border-border bg-white/[0.03] text-slate-300" />
        <StatusPill
          label="Awaiting approval"
          count={s?.submitted_count ?? 0}
          tone="border-amber-500/40 bg-amber-500/10 text-amber-200"
          amount={s ? `₹${s.submitted_pending_total} pending` : undefined}
        />
        <StatusPill
          label="Approved"
          count={s?.approved_count ?? 0}
          tone="border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          amount={s ? `₹${s.approved_total}` : undefined}
        />
        <StatusPill
          label="Rejected"
          count={s?.rejected_count ?? 0}
          tone="border-rose-500/30 bg-rose-500/10 text-rose-200"
        />
      </section>

      {/* Trend chart */}
      <GlassCard>
        <h2 className="text-lg font-semibold text-white">Approved expenses per day</h2>
        <p className="mt-1 text-xs text-slate-500">Every day in the window; zeros are included.</p>
        <div className="mt-6">
          <BarChart
            data={(trendQuery.data ?? []).map((r) => ({
              label: r.day.slice(5),
              value: Number(r.approved_total),
              tooltip: `${r.day} · ${r.approved_count} expenses · ₹${r.approved_total}`,
            }))}
            formatValue={(v) => `₹${v.toFixed(0)}`}
            height={180}
          />
        </div>
      </GlassCard>

      {/* Category table + P&L breakdown side by side */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Approved expenses by category</h2>
          <p className="mt-1 text-xs text-slate-500">Ranked by spend.</p>
          <div className="mt-4">
            <DataTable
              columns={categoryColumns}
              rows={byCategoryQuery.data ?? []}
              rowKey={(r) => r.category_id}
              empty={byCategoryQuery.isLoading ? 'Loading…' : 'No approved expenses in this window.'}
            />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <Scale className="h-5 w-5 text-cobalt-300" />
            P&L breakdown
          </div>
          <p className="mt-1 text-xs text-slate-500">
            All rupees; positive numbers flow towards profit.
          </p>
          <dl className="mt-6 space-y-2 text-sm">
            <Row label="Revenue" value={pnl ? `₹${pnl.revenue}` : '—'} tone="positive" strong />
            <Row label="Discounts" value={pnl ? `− ₹${pnl.discounts}` : '—'} tone="dim" />
            <Row label="Tax collected" value={pnl ? `₹${pnl.tax_collected}` : '—'} tone="dim" />
            <div className="my-2 border-t border-border" />
            <Row label="Net revenue" value={pnl ? `₹${pnl.net_revenue}` : '—'} strong />
            <Row label="Cost of goods sold" value={pnl ? `− ₹${pnl.cost_of_goods_sold}` : '—'} tone="negative" />
            <div className="my-2 border-t border-border" />
            <Row label="Gross profit" value={pnl ? `₹${pnl.gross_profit}` : '—'} strong />
            <Row label="Operating expenses" value={pnl ? `− ₹${pnl.operating_expenses}` : '—'} tone="negative" />
            <div className="my-2 border-t border-border-strong" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-white">Net profit</span>
              <span
                className={
                  Number(pnl?.net_profit ?? '0') >= 0
                    ? 'font-mono text-2xl font-semibold text-emerald-300'
                    : 'font-mono text-2xl font-semibold text-rose-300'
                }
              >
                ₹{pnl?.net_profit ?? '0.00'}
              </span>
            </div>
            {pnl?.net_margin_pct && (
              <div className="flex items-center justify-end gap-1 text-xs text-slate-400">
                <Percent className="h-3 w-3" /> {pnl.net_margin_pct}% net margin
              </div>
            )}
          </dl>
        </GlassCard>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <Coins className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          <strong className="text-slate-300">COGS is estimated</strong> — uses the variant's
          current cost price as a proxy. Set accurate costs and Phase 3 will layer on
          real FIFO cost accounting. Submitted-but-not-approved expenses appear as
          "pending" and don't reduce P&L until a manager approves them.
        </span>
      </div>
    </div>
  );
}

function StatusPill({
  label, count, tone, amount,
}: {
  label: string;
  count: number;
  tone: string;
  amount?: string;
}): JSX.Element {
  return (
    <div className={`glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3`}>
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
        <div className="mt-1 font-mono text-2xl font-semibold text-white">{count}</div>
        {amount && <div className="mt-1 text-xs text-slate-400">{amount}</div>}
      </div>
      <div className={`h-2 w-2 rounded-full ${tone.split(' ').find((t) => t.startsWith('bg-')) ?? ''}`} />
    </div>
  );
}

function Row({
  label, value, tone, strong,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'dim';
  strong?: boolean;
}): JSX.Element {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-200'
      : tone === 'negative'
        ? 'text-rose-200'
        : tone === 'dim'
          ? 'text-slate-400'
          : 'text-slate-100';
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-medium text-slate-200' : 'text-slate-400'}>{label}</dt>
      <dd className={`font-mono ${toneClass} ${strong ? 'text-base font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
