import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Banknote,
  CreditCard,
  Download,
  IndianRupee,
  Receipt,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { ApiError } from '@/lib/api';
import { downloadSalesCsv } from '@/lib/dashboard-api';
import { dailyTrend, salesSummary, topProducts } from '@/lib/reports-api';
import { listStores } from '@/lib/stores-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function Reports(): JSX.Element {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);

  const [fromDate, setFromDate] = useState<string>(iso(weekAgo));
  const [toDate, setToDate] = useState<string>(iso(today));
  const [storeId, setStoreId] = useState<string>('');

  const params = { from_date: fromDate, to_date: toDate, store_id: storeId || undefined };

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const summaryQuery = useQuery({
    queryKey: ['reports', 'summary', params],
    queryFn: () => salesSummary(params),
  });
  const topQuery = useQuery({
    queryKey: ['reports', 'top', params],
    queryFn: () => topProducts({ ...params, limit: '10' }),
  });
  const trendQuery = useQuery({
    queryKey: ['reports', 'trend', params],
    queryFn: () => dailyTrend(params),
  });

  const maxTrend = useMemo(
    () => Math.max(1, ...(trendQuery.data?.map((r) => Number(r.gross_total)) ?? [1])),
    [trendQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Filterable rollups plus CSV export. The Dashboard is your live view — this is the drill-down."
        actions={
          <Button
            variant="secondary"
            leadingIcon={<Download className="h-4 w-4" />}
            onClick={() =>
              void downloadSalesCsv({
                from_date: fromDate,
                to_date: toDate,
                store_id: storeId || undefined,
              })
            }
          >
            Export CSV
          </Button>
        }
      />

      <div className="glass flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px]">
          <Select
            placeholder="— All stores —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`, value: s.id,
            }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {summaryQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {summaryQuery.error instanceof ApiError ? summaryQuery.error.message : 'Failed to load reports.'}
        </div>
      )}

      {/* KPI row */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Gross sales"
          value={summaryQuery.data ? `₹${summaryQuery.data.gross_total}` : '—'}
          hint={`${summaryQuery.data?.sales_count ?? 0} sales`}
          icon={IndianRupee}
          accent="cobalt"
        />
        <StatTile
          label="Tax collected"
          value={summaryQuery.data ? `₹${summaryQuery.data.tax_total}` : '—'}
          icon={Receipt}
        />
        <StatTile
          label="Discounts given"
          value={summaryQuery.data ? `₹${summaryQuery.data.discount_total}` : '—'}
          icon={TrendingUp}
          accent="aurora"
        />
        <StatTile
          label="Net (pre-tax)"
          value={summaryQuery.data ? `₹${summaryQuery.data.net_total}` : '—'}
          icon={BarChart3}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Payment mix */}
        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Payment mix</h2>
          <p className="mt-1 text-xs text-slate-500">Where the money came in from.</p>
          <ul className="mt-4 space-y-2">
            <PaymentBar
              icon={<Banknote className="h-4 w-4" />}
              label="Cash"
              value={summaryQuery.data?.cash_total}
              total={summaryQuery.data?.gross_total}
            />
            <PaymentBar
              icon={<CreditCard className="h-4 w-4" />}
              label="Card"
              value={summaryQuery.data?.card_total}
              total={summaryQuery.data?.gross_total}
            />
            <PaymentBar
              icon={<Smartphone className="h-4 w-4" />}
              label="UPI"
              value={summaryQuery.data?.upi_total}
              total={summaryQuery.data?.gross_total}
            />
            <PaymentBar
              icon={<Wallet className="h-4 w-4" />}
              label="Other"
              value={summaryQuery.data?.other_total}
              total={summaryQuery.data?.gross_total}
            />
          </ul>
        </GlassCard>

        {/* Daily trend — simple SVG sparkline */}
        <GlassCard className="xl:col-span-2">
          <h2 className="text-lg font-semibold text-white">Daily trend</h2>
          <p className="mt-1 text-xs text-slate-500">Gross sales per day in the selected window.</p>
          <div className="mt-4 flex items-end gap-1 overflow-x-auto pb-2">
            {(trendQuery.data ?? []).map((r) => {
              const v = Number(r.gross_total);
              const h = Math.max(6, Math.round((v / maxTrend) * 140));
              return (
                <div
                  key={r.day}
                  className="flex min-w-[36px] flex-col items-center gap-1"
                  title={`${r.day}: ₹${r.gross_total} (${r.sales_count} sales)`}
                >
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-cobalt-600 to-cobalt-400"
                    style={{ height: `${h}px` }}
                  />
                  <div className="text-[10px] text-slate-500">{r.day.slice(5)}</div>
                </div>
              );
            })}
            {(!trendQuery.data || trendQuery.data.length === 0) && (
              <div className="text-sm text-slate-500">No sales in this window.</div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Top products */}
      <GlassCard>
        <h2 className="text-lg font-semibold text-white">Top products</h2>
        <p className="mt-1 text-xs text-slate-500">Best sellers by revenue.</p>
        <table className="mt-4 w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2">Product</th>
              <th className="py-2 text-right">Qty sold</th>
              <th className="py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {(topQuery.data ?? []).map((row) => (
              <tr key={row.variant_id} className="border-b border-border/60 last:border-b-0">
                <td className="py-2">
                  <div className="font-medium text-white">{row.product_name}</div>
                  <div className="font-mono text-xs text-slate-500">{row.sku}</div>
                </td>
                <td className="py-2 text-right font-mono text-slate-100">{row.quantity_sold}</td>
                <td className="py-2 text-right font-mono text-slate-100">₹{row.revenue}</td>
              </tr>
            ))}
            {(!topQuery.data || topQuery.data.length === 0) && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-slate-500">
                  No sales yet — ring up a few and refresh.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>
    </div>
  );
}

function PaymentBar({
  icon, label, value, total,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | undefined;
  total: string | undefined;
}): JSX.Element {
  const v = Number(value ?? 0);
  const t = Number(total ?? 0);
  const pct = t > 0 ? Math.min(Math.round((v / t) * 100), 100) : 0;
  return (
    <li>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-2 text-slate-300">{icon} {label}</span>
        <span className="font-mono text-slate-100">₹{value ?? '0.00'} <span className="text-slate-500">· {pct}%</span></span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full bg-gradient-to-r from-cobalt-500 to-aurora-500" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}
