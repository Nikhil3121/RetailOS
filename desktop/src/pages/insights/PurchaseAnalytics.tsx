import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IndianRupee, Info, Receipt, ShieldCheck, Truck } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { KpiCard } from '@/components/bi/KpiCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api';
import {
  purchaseSummary,
  purchaseTrend,
  supplierScorecards,
  topPurchaseCost,
  type PurchaseCostRow,
  type SupplierScorecard,
} from '@/lib/purchase-analytics-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function PurchaseAnalytics(): JSX.Element {
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 29);

  const [fromDate, setFromDate] = useState<string>(iso(monthAgo));
  const [toDate, setToDate] = useState<string>(iso(today));
  const params = { from_date: fromDate, to_date: toDate };

  const summaryQuery = useQuery({
    queryKey: ['pa-summary', params],
    queryFn: () => purchaseSummary(params),
  });
  const trendQuery = useQuery({
    queryKey: ['pa-trend', params],
    queryFn: () => purchaseTrend(params),
  });
  const suppliersQuery = useQuery({
    queryKey: ['pa-suppliers', params],
    queryFn: () => supplierScorecards(params),
  });
  const topCostQuery = useQuery({
    queryKey: ['pa-top-cost', params],
    queryFn: () => topPurchaseCost({ ...params, limit: 15 }),
  });

  const s = summaryQuery.data;
  const activeSuppliers = (suppliersQuery.data ?? []).filter((r) => r.po_count > 0);

  const supplierColumns = useMemo<Column<SupplierScorecard>[]>(
    () => [
      {
        key: 'supplier',
        header: 'Supplier',
        cell: (r) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Truck className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{r.supplier_name}</div>
              <div className="font-mono text-xs text-slate-500">{r.supplier_code}</div>
            </div>
          </div>
        ),
      },
      { key: 'pos', header: 'POs', align: 'right', cell: (r) => <span className="font-mono">{r.po_count}</span> },
      {
        key: 'completed',
        header: 'Completed',
        align: 'right',
        cell: (r) => {
          const rate = r.po_count > 0 ? Math.round((r.completed_pos / r.po_count) * 100) : 0;
          return (
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-slate-300">
                {r.completed_pos} <span className="text-slate-500">/ {r.po_count}</span>
              </span>
              <span
                className={
                  rate >= 90
                    ? 'text-xs text-emerald-300'
                    : rate >= 60
                      ? 'text-xs text-cobalt-300'
                      : 'text-xs text-amber-300'
                }
              >
                {rate}%
              </span>
            </div>
          );
        },
      },
      {
        key: 'turnaround',
        header: 'Avg turnaround',
        align: 'right',
        cell: (r) =>
          r.avg_turnaround_days ? (
            <span className="font-mono text-slate-100">{r.avg_turnaround_days}d</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'spend',
        header: 'Total spend',
        align: 'right',
        cell: (r) => <span className="font-mono text-white">₹{r.total_spend}</span>,
      },
      {
        key: 'last',
        header: 'Last order',
        cell: (r) =>
          r.last_order_at ? (
            <span className="text-slate-300">{r.last_order_at}</span>
          ) : (
            <span className="text-slate-500">Never</span>
          ),
      },
    ],
    [],
  );

  const costColumns = useMemo<Column<PurchaseCostRow>[]>(
    () => [
      {
        key: 'product',
        header: 'Product',
        cell: (r) => (
          <div>
            <div className="font-medium text-white">{r.product_name}</div>
            <div className="font-mono text-xs text-slate-500">{r.sku}</div>
          </div>
        ),
      },
      { key: 'ordered', header: 'Ordered', align: 'right', cell: (r) => <span className="font-mono">{r.total_units_ordered}</span> },
      { key: 'received', header: 'Received', align: 'right', cell: (r) => <span className="font-mono text-emerald-300">{r.total_units_received}</span> },
      { key: 'avg', header: 'Avg unit cost', align: 'right', cell: (r) => <span className="font-mono">₹{r.average_unit_cost}</span> },
      { key: 'total', header: 'Total cost', align: 'right', cell: (r) => <span className="font-mono text-white">₹{r.total_cost}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase analytics"
        description="Supplier performance, spend trends, and product-level purchase cost."
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {summaryQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {summaryQuery.error instanceof ApiError ? summaryQuery.error.message : 'Failed to load.'}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total spend"
          value={s ? `₹${s.total_spend}` : '—'}
          hint={`${s?.po_count ?? 0} purchase orders`}
          icon={IndianRupee}
          accent="cobalt"
        />
        <KpiCard
          label="Received"
          value={s ? `₹${s.completed_spend}` : '—'}
          icon={ShieldCheck}
          accent="emerald"
        />
        <KpiCard
          label="Cancelled"
          value={s ? `₹${s.cancelled_spend}` : '—'}
          icon={Receipt}
        />
        <KpiCard
          label="Suppliers used"
          value={s ? s.unique_suppliers : '—'}
          icon={Truck}
        />
      </section>

      <GlassCard>
        <h2 className="text-lg font-semibold text-white">Daily purchase spend</h2>
        <p className="mt-1 text-xs text-slate-500">Grand total across all POs created each day.</p>
        <div className="mt-6">
          <BarChart
            data={(trendQuery.data ?? []).map((r) => ({
              label: r.day.slice(5),
              value: Number(r.total_spend),
              tooltip: `${r.day} · ${r.po_count} POs · ₹${r.total_spend}`,
            }))}
            formatValue={(v) => `₹${v.toFixed(0)}`}
            height={180}
          />
        </div>
      </GlassCard>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Supplier scorecards
        </h2>
        <DataTable
          columns={supplierColumns}
          rows={activeSuppliers}
          rowKey={(r) => r.supplier_id}
          empty={suppliersQuery.isLoading ? 'Loading…' : 'No supplier activity in this window.'}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Top spend by product
        </h2>
        <DataTable
          columns={costColumns}
          rows={topCostQuery.data ?? []}
          rowKey={(r) => r.variant_id}
          empty={topCostQuery.isLoading ? 'Loading…' : 'No purchase lines yet.'}
        />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <Info className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          Avg turnaround is computed from POs where{' '}
          <strong className="text-slate-200">received_at</strong> is set — i.e.
          confirmed then received via the PO workflow. Pending payments + purchase
          returns are separate modules on the Phase 4 roadmap.
        </span>
      </div>
    </div>
  );
}
