/**
 * Where the money actually comes from.
 *
 * Two questions on one screen, because they are always asked together:
 *
 *   WHICH ITEMS EARN — margin per item, from the cost recorded at the time of
 *   sale. Sorted by profit rather than revenue: the best-selling item and the
 *   most profitable one are routinely different, and the second is the one
 *   nobody can see from the sales screen.
 *
 *   WHERE THE TAKINGS SIT — the same period sliced by brand, category, size or
 *   salesperson. One control, four answers.
 *
 * THE HONESTY BANNER IS NOT OPTIONAL
 * Bills written before costs were snapshotted carry none, and there is no
 * truthful way to invent one — today's cost price is not what those goods cost
 * when they sold. The server excludes them from the totals and reports how
 * much revenue they represent. This screen must show that whenever it is
 * non-zero: a margin covering half a period, presented as the whole, is worse
 * than no margin at all.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TrendingUp } from 'lucide-react';

import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { itemProfit, salesBy, type SalesDimension } from '@/lib/reports-api';
import { listStores } from '@/lib/stores-api';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const DIMENSIONS: { value: SalesDimension; label: string }[] = [
  { value: 'brand', label: 'Brand' },
  { value: 'category', label: 'Category' },
  // Size is the variant name in a garment shop — M, XL, 38.
  { value: 'size', label: 'Size' },
  { value: 'salesperson', label: 'Salesperson' },
];

export function Profitability(): JSX.Element {
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 29);

  const [fromDate, setFromDate] = useState(iso(monthAgo));
  const [toDate, setToDate] = useState(iso(today));
  const [storeId, setStoreId] = useState('');
  const [dimension, setDimension] = useState<SalesDimension>('brand');

  const params = { from_date: fromDate, to_date: toDate, store_id: storeId || undefined };

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const profitQuery = useQuery({
    queryKey: ['item-profit', params],
    queryFn: () => itemProfit({ ...params, limit: '100' }),
  });
  const breakdownQuery = useQuery({
    queryKey: ['sales-by', dimension, params],
    queryFn: () => salesBy({ dimension, ...params }),
  });

  const profit = profitQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profitability"
        description="What each item earned, and where the takings came from."
      />

      <GlassCard className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <Select
            label="Branch"
            placeholder="— Both malls —"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            options={(storesQuery.data?.items ?? []).map((s) => ({
              value: s.id,
              label: `${s.code} · ${s.name}`,
            }))}
          />
        </div>
      </GlassCard>

      {profitQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {profitQuery.error instanceof ApiError
            ? profitQuery.error.message
            : 'Could not load the margin report.'}
        </div>
      )}

      {profit && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Revenue" value={formatMoney(profit.total_revenue)} />
            <StatTile label="Cost of goods" value={formatMoney(profit.total_cost)} />
            {/* StatTile takes the component, not an element. */}
            <StatTile
              label="Profit"
              value={formatMoney(profit.total_profit)}
              icon={TrendingUp}
            />
          </div>

          {/* Shown whenever the server says part of the period could not be
              costed. Without it these totals read as the whole picture. */}
          {profit.uncosted_lines > 0 && (
            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These figures do not cover the whole period.{' '}
                <span className="font-semibold">{profit.uncosted_lines}</span> sale
                line{profit.uncosted_lines === 1 ? '' : 's'} worth{' '}
                <span className="font-semibold">
                  {formatMoney(profit.uncosted_revenue)}
                </span>{' '}
                have no cost recorded — they were sold before costs were kept on
                the bill, and there is no honest way to price them now. They are
                left out rather than guessed at.
              </span>
            </div>
          )}

          <GlassCard className="overflow-hidden">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-100">
              Margin by item
              <span className="ml-2 text-xs font-normal text-slate-500">
                Sorted by profit — the biggest seller is often not the best earner.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Sold</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                    <th className="px-4 py-2 text-right">Profit</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {profit.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Nothing sold with a recorded cost in this period.
                      </td>
                    </tr>
                  ) : (
                    profit.rows.map((row) => {
                      const margin = row.margin_pct === null ? null : Number(row.margin_pct);
                      return (
                        <tr key={row.variant_id}>
                          <td className="px-4 py-2">
                            <div className="text-slate-100">{row.product_name}</div>
                            <div className="text-xs text-slate-500">
                              {row.variant_name} · {row.sku}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-300">
                            {Number(row.quantity_sold)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-300">
                            {formatMoney(row.revenue)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                            {row.cost === null ? '—' : formatMoney(row.cost)}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-2 text-right tabular-nums',
                              row.profit !== null && Number(row.profit) < 0
                                ? 'text-rose-300'
                                : 'text-emerald-300',
                            )}
                          >
                            {row.profit === null ? '—' : formatMoney(row.profit)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                            {margin === null ? '—' : `${margin}%`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}

      <GlassCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Where the takings came from</span>
          <div className="w-44">
            <Select
              value={dimension}
              onChange={(e) => setDimension(e.target.value as SalesDimension)}
              options={DIMENSIONS}
            />
          </div>
        </div>

        {breakdownQuery.isError ? (
          <div className="px-4 py-3 text-sm text-rose-200">
            Could not load that breakdown.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(breakdownQuery.data ?? []).length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                Nothing sold in this period.
              </li>
            ) : (
              (breakdownQuery.data ?? []).map((row) => {
                const share = Number(row.share_pct);
                return (
                  <li key={`${row.key_id ?? 'none'}-${row.label}`} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-slate-100">{row.label}</span>
                      <span className="shrink-0 tabular-nums text-slate-300">
                        {formatMoney(row.revenue)}
                        <span className="ml-2 text-xs text-slate-500">
                          {share}% · {Number(row.quantity_sold)} pc
                        </span>
                      </span>
                    </div>
                    {/* A bar, because a share is a comparison and a column of
                        percentages is not one anybody reads. */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-cobalt-500/70"
                        style={{ width: `${Math.max(1, Math.min(100, share))}%` }}
                      />
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
