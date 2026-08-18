import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  Flame,
  Gauge,
  IndianRupee,
  Info,
  Snowflake,
  Warehouse,
} from 'lucide-react';

import { KpiCard } from '@/components/bi/KpiCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  healthSummary,
  inventoryAging,
  inventoryValue,
  MOVEMENT_LABEL,
  movementAnalysis,
  STOCK_LABEL,
  stockAlerts,
  type MovementCategory,
  type MovementRow,
  type StockAlertRow,
  type StockCategory,
} from '@/lib/inventory-intelligence-api';
import { listStores } from '@/lib/stores-api';

const STOCK_TONE: Record<StockCategory, string> = {
  out_of_stock: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  low: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  healthy: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  overstock: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
};

const MOVEMENT_TONE: Record<MovementCategory, string> = {
  fast: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  slow: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  dead: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  normal: 'border-border bg-white/[0.03] text-slate-300',
};

export function InventoryHealth(): JSX.Element {
  const [storeId, setStoreId] = useState<string>('');
  const [alertFilter, setAlertFilter] = useState<StockCategory | ''>('low');
  const [movementFilter, setMovementFilter] = useState<MovementCategory | ''>('');

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const summaryQuery = useQuery({
    queryKey: ['inv-intel-summary', storeId],
    queryFn: () => healthSummary({ store_id: storeId || undefined }),
    refetchInterval: 60_000,
  });
  const alertsQuery = useQuery({
    queryKey: ['inv-intel-alerts', storeId, alertFilter],
    queryFn: () =>
      stockAlerts({
        store_id: storeId || undefined,
        category: alertFilter ? [alertFilter] : ['out_of_stock', 'low', 'overstock'],
      }),
  });
  const movementQuery = useQuery({
    queryKey: ['inv-intel-movement', storeId],
    queryFn: () => movementAnalysis({ store_id: storeId || undefined }),
  });
  const valueQuery = useQuery({
    queryKey: ['inv-intel-value', storeId],
    queryFn: () => inventoryValue(storeId || undefined),
  });
  const agingQuery = useQuery({
    queryKey: ['inv-intel-aging', storeId],
    queryFn: () => inventoryAging({ store_id: storeId || undefined, limit: 200 }),
  });

  const s = summaryQuery.data;

  const filteredMovement = useMemo(() => {
    const rows = movementQuery.data ?? [];
    return movementFilter ? rows.filter((r) => r.category === movementFilter) : rows;
  }, [movementQuery.data, movementFilter]);

  const alertColumns = useMemo<Column<StockAlertRow>[]>(
    () => [
      {
        key: 'product',
        header: 'Product',
        cell: (r) => (
          <div>
            <div className="font-medium text-white">{r.product_name}</div>
            <div className="font-mono text-xs text-slate-500">
              {r.sku} · {r.store_code}
            </div>
          </div>
        ),
      },
      {
        key: 'qty',
        header: 'On hand',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-100">{r.quantity}</span>,
      },
      {
        key: 'reorder',
        header: 'Reorder pt',
        align: 'right',
        cell: (r) =>
          Number(r.reorder_point) > 0 ? (
            <span className="font-mono text-slate-400">{r.reorder_point}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'cover',
        header: 'Days cover',
        align: 'right',
        cell: (r) =>
          r.days_of_cover ? (
            <span
              className={
                Number(r.days_of_cover) < 3
                  ? 'font-mono text-rose-300'
                  : Number(r.days_of_cover) < 7
                    ? 'font-mono text-amber-300'
                    : 'font-mono text-slate-100'
              }
            >
              {r.days_of_cover}d
            </span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'suggested',
        header: 'Suggested buy',
        align: 'right',
        cell: (r) =>
          r.suggested_reorder_qty ? (
            <span className="font-mono text-emerald-300">+{r.suggested_reorder_qty}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'cat',
        header: 'Category',
        cell: (r) => (
          <span className={`rounded-full border px-2 py-0.5 text-xs ${STOCK_TONE[r.category]}`}>
            {STOCK_LABEL[r.category]}
          </span>
        ),
      },
    ],
    [],
  );

  const movementColumns = useMemo<Column<MovementRow>[]>(
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
      {
        key: 'onhand',
        header: 'On hand',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-100">{r.on_hand}</span>,
      },
      {
        key: 'sold',
        header: 'Sold (30d)',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-300">{r.sold_last_window}</span>,
      },
      {
        key: 'velocity',
        header: 'Velocity /d',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-100">{r.velocity_per_day}</span>,
      },
      {
        key: 'last',
        header: 'Last sale',
        cell: (r) =>
          r.last_sale_at ? (
            <span className="text-slate-300">{r.last_sale_at}</span>
          ) : (
            <span className="text-slate-500">Never</span>
          ),
      },
      {
        key: 'cat',
        header: 'Category',
        cell: (r) => (
          <span className={`rounded-full border px-2 py-0.5 text-xs ${MOVEMENT_TONE[r.category]}`}>
            {MOVEMENT_LABEL[r.category]}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory health"
        description="Live snapshot of stock levels, sales velocity, aging, and value. Refreshes every minute."
        actions={
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
        }
      />

      {(summaryQuery.isError || valueQuery.isError) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {summaryQuery.error instanceof ApiError
            ? summaryQuery.error.message
            : 'Failed to load intelligence.'}
        </div>
      )}

      {/* KPI row */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Inventory value"
          value={s ? `₹${s.total_inventory_value}` : '—'}
          hint="At variant cost price"
          icon={IndianRupee}
          accent="cobalt"
        />
        <KpiCard
          label="Out of stock"
          value={s ? s.out_of_stock_count : '—'}
          hint="SKUs at zero"
          icon={AlertOctagon}
          accent="slate"
        />
        <KpiCard
          label="Low stock"
          value={s ? s.low_stock_count : '—'}
          hint="Below reorder point"
          icon={AlertTriangle}
          accent="aurora"
        />
        <KpiCard
          label="Dead stock"
          value={s ? s.dead_stock_count : '—'}
          hint="No sale in 60+ days"
          icon={Snowflake}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="SKUs in stock"
          value={s ? s.total_skus_in_stock : '—'}
          icon={Boxes}
        />
        <KpiCard
          label="Fast movers"
          value={s ? s.fast_movers_count : '—'}
          hint="≥ 1 unit/day"
          icon={Flame}
          accent="emerald"
        />
        <KpiCard
          label="Slow movers"
          value={s ? s.slow_movers_count : '—'}
          hint="≤ 0.1 unit/day"
          icon={Gauge}
        />
        <KpiCard
          label="Overstock"
          value={s ? s.overstock_count : '—'}
          hint="Above overstock point"
          icon={Warehouse}
        />
      </section>

      {/* Stock alerts */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Stock alerts
            </h2>
            <p className="text-xs text-slate-500">
              Sorted most urgent first. Suggested buy = reorder point + reorder buffer − on hand.
            </p>
          </div>
          <div className="w-48">
            <Select
              options={[
                { label: 'Out of stock', value: 'out_of_stock' },
                { label: 'Low', value: 'low' },
                { label: 'Overstock', value: 'overstock' },
                { label: 'Healthy', value: 'healthy' },
              ]}
              placeholder="— Alerts only —"
              value={alertFilter}
              onChange={(e) => setAlertFilter(e.target.value as StockCategory | '')}
            />
          </div>
        </div>
        <DataTable
          columns={alertColumns}
          rows={alertsQuery.data ?? []}
          rowKey={(r) => `${r.variant_id}-${r.store_id}`}
          empty={
            alertsQuery.isLoading
              ? 'Loading…'
              : 'Nothing matches. Set reorder points on your variants so alerts trigger.'
          }
        />
      </div>

      {/* Movement */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Movement analysis
            </h2>
            <p className="text-xs text-slate-500">
              Fast ≥ 1/day · Slow ≤ 0.1/day · Dead = on-hand with no sales in 60+ days.
            </p>
          </div>
          <div className="w-48">
            <Select
              options={[
                { label: 'Fast moving', value: 'fast' },
                { label: 'Slow moving', value: 'slow' },
                { label: 'Dead', value: 'dead' },
                { label: 'Normal', value: 'normal' },
              ]}
              placeholder="— All —"
              value={movementFilter}
              onChange={(e) => setMovementFilter(e.target.value as MovementCategory | '')}
            />
          </div>
        </div>
        <DataTable
          columns={movementColumns}
          rows={filteredMovement}
          rowKey={(r) => r.variant_id}
          empty={movementQuery.isLoading ? 'Loading…' : 'No movement data.'}
        />
      </div>

      {/* Value + aging */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Inventory value by store</h2>
          <p className="mt-1 text-xs text-slate-500">On-hand × cost price.</p>
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">Store</th>
                <th className="py-2 text-right">SKU lines</th>
                <th className="py-2 text-right">On hand</th>
                <th className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {(valueQuery.data?.per_store ?? []).map((r) => (
                <tr key={r.store_id} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium text-white">{r.store_name}</div>
                    <div className="font-mono text-xs text-slate-500">{r.store_code}</div>
                  </td>
                  <td className="py-2 text-right font-mono">{r.line_count}</td>
                  <td className="py-2 text-right font-mono text-slate-300">{r.on_hand_units}</td>
                  <td className="py-2 text-right font-mono text-white">₹{r.inventory_value}</td>
                </tr>
              ))}
              {valueQuery.data && (
                <tr className="border-t border-border-strong">
                  <td className="py-3 text-right text-slate-400" colSpan={3}>Total</td>
                  <td className="py-3 text-right font-mono text-lg font-semibold text-white">
                    ₹{valueQuery.data.inventory_value}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </GlassCard>

        <GlassCard>
          <h2 className="text-lg font-semibold text-white">Aging</h2>
          <p className="mt-1 text-xs text-slate-500">
            How long since stock last came in. Older buckets are opportunities to move product.
          </p>
          <ul className="mt-4 space-y-2">
            {['0-30', '31-60', '61-90', '90+', 'unknown'].map((bucket) => {
              const items = (agingQuery.data ?? []).filter((r) => r.bucket === bucket);
              const units = items.reduce((acc, r) => acc + Number(r.quantity), 0);
              return (
                <li
                  key={bucket}
                  className="flex items-center justify-between rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-sm"
                >
                  <span className="text-slate-300">{bucket} days</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{items.length} SKUs</span>
                    <span className="font-mono text-slate-100">{units.toFixed(3)} units</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </GlassCard>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          Set <strong className="text-slate-200">reorder point</strong> +{' '}
          <strong className="text-slate-200">reorder quantity</strong> on your variants
          (Products → edit → Variants tab) for the low-stock alerts and suggested-buy
          numbers to fire. <strong className="text-slate-200">Overstock point</strong> is
          optional — leave blank to disable that alert per variant.
        </span>
      </div>
    </div>
  );
}
