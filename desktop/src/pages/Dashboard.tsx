import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  CreditCard,
  IndianRupee,
  Info,
  Percent,
  Receipt,
  Settings2,
  ShoppingBag,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users as UsersIcon,
  Wallet,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { Donut } from '@/components/charts/Donut';
import { KpiCard } from '@/components/bi/KpiCard';
import {
  DashboardCustomizer,
  useDashboardLayout,
  type DashboardSection,
} from '@/components/bi/DashboardCustomizer';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  fetchDashboard,
  PERIOD_LABEL,
  type Period,
} from '@/lib/dashboard-api';
import { listStores } from '@/lib/stores-api';
import { formatMoney, formatPercent, sumDecimals } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

const SECTIONS: DashboardSection[] = [
  { id: 'kpi-row-1', label: 'Headline KPIs', description: 'Revenue · Sales · AOV · Customers' },
  { id: 'kpi-row-2', label: 'Profit KPIs', description: 'Est. profit · Margin · Tax · Discounts' },
  { id: 'charts', label: 'Hourly / daily chart + payment mix' },
  { id: 'tables', label: 'Top products + store comparison' },
  { id: 'profit-note', label: 'Profit disclosure note' },
];

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: PERIOD_LABEL.today, value: 'today' },
  { label: PERIOD_LABEL.yesterday, value: 'yesterday' },
  { label: PERIOD_LABEL.week, value: 'week' },
  { label: PERIOD_LABEL.month, value: 'month' },
  { label: PERIOD_LABEL.year, value: 'year' },
];

/**
 * Business-intelligence dashboard.
 *
 * The whole page is driven by one composite `/dashboard` payload. Selecting a
 * period or store re-fetches; nothing derives from stale conversation state.
 */
export function Dashboard(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('today');
  const [storeId, setStoreId] = useState<string>('');
  const [customizing, setCustomizing] = useState(false);

  const { visibleOrdered } = useDashboardLayout(SECTIONS);
  const visible = new Set(visibleOrdered.map((s) => s.id));
  const show = (id: string) => visible.has(id);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const dashQuery = useQuery({
    queryKey: ['dashboard', period, storeId],
    queryFn: () => fetchDashboard({ period, store_id: storeId || undefined }),
    refetchInterval: 60_000, // live-ish update every minute
  });

  const kpis = dashQuery.data?.kpis;

  // Two totals, deliberately. The EXACT one is what gets shown, summed as
  // integers so the headline figure equals the four legend rows beneath it.
  // The float is only ever used to work out a percentage width, which is a
  // proportion of a chart and not a sum of money.
  const paymentTotalExact = dashQuery.data
    ? sumDecimals([
        dashQuery.data.payment_mix.cash,
        dashQuery.data.payment_mix.card,
        dashQuery.data.payment_mix.upi,
        dashQuery.data.payment_mix.other,
      ])
    : '0';
  const paymentTotal = Number(paymentTotalExact);

  const daily = dashQuery.data?.daily_trend ?? [];
  const hourly = dashQuery.data?.hourly ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${user ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        description={
          dashQuery.data
            ? `${PERIOD_LABEL[period]} · ${dashQuery.data.from_date} → ${dashQuery.data.to_date} · vs ${dashQuery.data.previous_from} → ${dashQuery.data.previous_to}`
            : 'Loading business overview…'
        }
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <Select
                options={PERIOD_OPTIONS}
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
              />
            </div>
            <div className="w-56">
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
            <Button
              variant="secondary"
              leadingIcon={<Settings2 className="h-4 w-4" />}
              onClick={() => setCustomizing(true)}
            >
              Customize
            </Button>
          </div>
        }
      />

      <DashboardCustomizer
        open={customizing}
        onClose={() => setCustomizing(false)}
        sections={SECTIONS}
      />

      {dashQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {dashQuery.error instanceof ApiError
            ? dashQuery.error.message
            : 'Failed to load dashboard.'}
        </div>
      )}

      {/* Row 1 — headline KPIs */}
      {show('kpi-row-1') && (
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue"
          value={formatMoney(kpis?.revenue.current)}
          kpi={kpis?.revenue}
          icon={IndianRupee}
          accent="cobalt"
          spark={daily.map((d) => Number(d.gross_total))}
        />
        <KpiCard
          label="Sales"
          value={kpis ? kpis.sales_count.current : '—'}
          kpi={kpis?.sales_count}
          icon={Receipt}
          accent="aurora"
          spark={daily.map((d) => d.sales_count)}
        />
        <KpiCard
          label="Avg order value"
          value={formatMoney(kpis?.average_order_value.current)}
          kpi={kpis?.average_order_value}
          icon={ShoppingBag}
        />
        <KpiCard
          label="Unique customers"
          value={kpis ? kpis.unique_customers.current : '—'}
          kpi={kpis?.unique_customers}
          icon={UsersIcon}
        />
      </section>
      )}

      {/* Row 2 — profit + tax + discount */}
      {show('kpi-row-2') && (
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Est. profit"
          value={formatMoney(kpis?.estimated_profit.current)}
          kpi={kpis?.estimated_profit}
          icon={TrendingUp}
          accent="emerald"
          hint="Revenue − est. cost. See note below."
        />
        <KpiCard
          label="Est. margin"
          value={formatPercent(kpis?.estimated_margin_pct.current)}
          kpi={kpis?.estimated_margin_pct}
          icon={Percent}
          accent="emerald"
        />
        <KpiCard
          label="Tax collected"
          value={formatMoney(kpis?.tax_collected.current)}
          kpi={kpis?.tax_collected}
          icon={Receipt}
          // Money owed to the government, not takings. Up is not a win and
          // down is not a loss, so it gets no colour either way.
          direction="neutral"
        />
        <KpiCard
          label="Discounts given"
          value={formatMoney(kpis?.discounts_given.current)}
          kpi={kpis?.discounts_given}
          icon={Sparkles}
          // Giving away less is margin kept.
          direction="down-is-good"
        />
      </section>
      )}

      {/* Row 3 — charts */}
      {show('charts') && (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <GlassCard className="xl:col-span-2">
          <h2 className="text-lg font-semibold text-white">
            {period === 'today' ? 'Hourly sales · today' : 'Daily trend'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {period === 'today'
              ? 'Sales by hour of day. Peaks tell you when to staff up.'
              : 'Gross sales per day across the selected window.'}
          </p>
          <div className="mt-6">
            {period === 'today' ? (
              <BarChart
                data={hourly.map((h) => ({
                  label: `${h.hour}h`,
                  value: Number(h.gross_total),
                  tooltip: `${h.hour}:00–${h.hour + 1}:00 · ${h.sales_count} sales · ₹${h.gross_total}`,
                }))}
                formatValue={(v) => formatMoney(v, { decimals: 0 })}
                height={180}
              />
            ) : (
              <BarChart
                data={daily.map((d) => ({
                  label: d.day.slice(5),
                  value: Number(d.gross_total),
                  tooltip: `${d.day} · ${d.sales_count} sales · ₹${d.gross_total}`,
                }))}
                formatValue={(v) => formatMoney(v, { decimals: 0 })}
                height={180}
              />
            )}
          </div>
        </GlassCard>

        {/* Payment mix */}
        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Payment mix</h2>
          <p className="mt-1 text-xs text-slate-500">Money in by channel.</p>
          <div className="mt-6 flex items-center justify-center">
            <Donut
              size={180}
              thickness={26}
              centerLabel="Collected"
              centerValue={formatMoney(paymentTotalExact, { decimals: 0 })}
              slices={[
                { label: 'Cash', value: Number(dashQuery.data?.payment_mix.cash ?? 0), colorClass: 'stroke-cobalt-400' },
                { label: 'Card', value: Number(dashQuery.data?.payment_mix.card ?? 0), colorClass: 'stroke-aurora-400' },
                { label: 'UPI', value: Number(dashQuery.data?.payment_mix.upi ?? 0), colorClass: 'stroke-emerald-400' },
                { label: 'Other', value: Number(dashQuery.data?.payment_mix.other ?? 0), colorClass: 'stroke-slate-400' },
              ]}
            />
          </div>
          <ul className="mt-4 space-y-2 text-xs">
            <LegendRow
              icon={<Banknote className="h-3.5 w-3.5" />}
              swatch="bg-cobalt-400"
              label="Cash"
              value={dashQuery.data?.payment_mix.cash}
              total={paymentTotal}
            />
            <LegendRow
              icon={<CreditCard className="h-3.5 w-3.5" />}
              swatch="bg-aurora-400"
              label="Card"
              value={dashQuery.data?.payment_mix.card}
              total={paymentTotal}
            />
            <LegendRow
              icon={<Smartphone className="h-3.5 w-3.5" />}
              swatch="bg-emerald-400"
              label="UPI"
              value={dashQuery.data?.payment_mix.upi}
              total={paymentTotal}
            />
            <LegendRow
              icon={<Wallet className="h-3.5 w-3.5" />}
              swatch="bg-slate-400"
              label="Other"
              value={dashQuery.data?.payment_mix.other}
              total={paymentTotal}
            />
          </ul>
        </GlassCard>
      </div>
      )}

      {/* Row 4 — top products + store comparison */}
      {show('tables') && (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Top products by revenue</h2>
          <p className="mt-1 text-xs text-slate-500">
            Best sellers with estimated profit and margin.
          </p>
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(dashQuery.data?.top_products ?? []).slice(0, 8).map((r) => (
                <tr key={r.variant_id} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium text-white">{r.product_name}</div>
                    <div className="font-mono text-xs text-slate-500">{r.sku}</div>
                  </td>
                  <td className="py-2 text-right font-mono text-slate-100">{r.quantity_sold}</td>
                  <td className="py-2 text-right font-mono text-slate-100">₹{r.revenue}</td>
                  <td className="py-2 text-right">
                    {r.estimated_margin_pct !== null ? (
                      <span
                        className={
                          Number(r.estimated_margin_pct) >= 30
                            ? 'font-mono text-emerald-300'
                            : Number(r.estimated_margin_pct) >= 10
                              ? 'font-mono text-slate-100'
                              : 'font-mono text-amber-300'
                        }
                      >
                        {r.estimated_margin_pct}%
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(!dashQuery.data?.top_products || dashQuery.data.top_products.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    No sales in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Store comparison</h2>
          <p className="mt-1 text-xs text-slate-500">
            All stores in the current window — ignores the store filter above.
          </p>
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">Store</th>
                <th className="py-2 text-right">Sales</th>
                <th className="py-2 text-right">Gross</th>
                <th className="py-2 text-right">AOV</th>
              </tr>
            </thead>
            <tbody>
              {(dashQuery.data?.store_comparison ?? []).map((r) => (
                <tr key={r.store_id} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium text-white">{r.store_name}</div>
                    <div className="font-mono text-xs text-slate-500">{r.store_code}</div>
                  </td>
                  <td className="py-2 text-right font-mono text-slate-100">{r.sales_count}</td>
                  <td className="py-2 text-right font-mono text-slate-100">₹{r.gross_total}</td>
                  <td className="py-2 text-right font-mono text-slate-100">₹{r.average_order_value}</td>
                </tr>
              ))}
              {(!dashQuery.data?.store_comparison ||
                dashQuery.data.store_comparison.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-slate-500">
                    No stores configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </GlassCard>
      </div>
      )}

      {/* Profit disclosure */}
      {show('profit-note') && (
      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <Info className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          <strong className="text-slate-300">Profit is estimated.</strong>{' '}
          Uses the variant's <em>current</em> cost price as a proxy for cost at time of sale.
          Set accurate cost prices on variants for meaningful numbers. Phase 3 layers on proper
          FIFO cost accounting.
        </span>
      </div>
      )}
    </div>
  );
}

function LegendRow({
  icon, swatch, label, value, total,
}: {
  icon: React.ReactNode;
  swatch: string;
  label: string;
  value: string | undefined;
  total: number;
}): JSX.Element {
  const v = Number(value ?? 0);
  const pct = total > 0 ? Math.round((v / total) * 100) : 0;
  return (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-300">
        <span className={`inline-block h-2 w-2 rounded-full ${swatch}`} />
        {icon} {label}
      </span>
      <span className="font-mono text-slate-100">
        {formatMoney(value, { fallback: '₹0.00' })}
        <span className="ml-2 text-slate-500">· {pct}%</span>
      </span>
    </li>
  );
}
