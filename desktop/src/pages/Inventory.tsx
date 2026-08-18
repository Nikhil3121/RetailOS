import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Boxes,
  History,
  Layers,
  Minus,
  PackagePlus,
  Plus,
  ScanBarcode,
  Search,
  Wrench,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { getProduct, listProducts } from '@/lib/catalog-api';
import {
  adjustStock,
  listMovements,
  MOVEMENT_LABEL,
  stockLevels,
  transferStock,
  type AdjustmentLine,
  type StockFilter,
  type StockLevelRow,
} from '@/lib/inventory-api';
import { listStores } from '@/lib/stores-api';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth-store';

const LAST_STORE_KEY = 'retailos.inventory.last_store_id';

interface CatalogVariant {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product_name: string;
  variant_name: string;
  unit_symbol: string;
}

/**
 * Fully-featured inventory grid.
 *
 * Every active variant appears — even ones with no stock movement yet — so the
 * cashier can bring a fresh product to non-zero stock by scanning or picking
 * from the row. Actions:
 *   – inline **+1 / −1**  → single adjustment against the visible row
 *   – **Receive**         → dedicated stock-in modal, per row or bulk
 *   – **Adjust**          → signed delta with a reason (breakage, cycle count,
 *                            opening balance — the latter allows negatives)
 *   – **Transfer**        → move stock between two stores
 *   – **History**         → ledger drawer for a variant
 */
export function Inventory(): JSX.Element {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });

  // Default the store filter to the user's assigned store, else the first store
  // once it loads. Persist across sessions.
  const [storeId, setStoreId] = useState<string>(
    () => localStorage.getItem(LAST_STORE_KEY) ?? user?.store_id ?? '',
  );
  useEffect(() => {
    if (!storeId && storesQuery.data?.items?.[0]) {
      setStoreId(storesQuery.data.items[0].id);
    }
  }, [storeId, storesQuery.data]);
  useEffect(() => {
    if (storeId) localStorage.setItem(LAST_STORE_KEY, storeId);
  }, [storeId]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'' | StockFilter>('');
  const [scanBuffer, setScanBuffer] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const levelsQuery = useQuery({
    queryKey: ['inventory-levels', storeId, search, filter],
    queryFn: () =>
      stockLevels({
        store_id: storeId || undefined,
        search: search.trim() || undefined,
        stock_filter: filter || undefined,
        page_size: 500,
      }),
    enabled: !!storeId,
  });

  const [openAdjust, setOpenAdjust] = useState(false);
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openReceive, setOpenReceive] = useState<StockLevelRow | 'blank' | null>(null);
  const [openBulk, setOpenBulk] = useState(false);
  const [openHistory, setOpenHistory] = useState<StockLevelRow | null>(null);

  const rows = levelsQuery.data?.items ?? [];

  // Aggregate stats for the summary strip.
  const stats = useMemo(() => {
    let inStock = 0;
    let low = 0;
    let out = 0;
    for (const r of rows) {
      const q = Number(r.quantity);
      const rp = Number(r.reorder_point);
      if (q <= 0) out += 1;
      else if (rp > 0 && q <= rp) low += 1;
      else inStock += 1;
    }
    return { inStock, low, out, total: rows.length };
  }, [rows]);

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['inventory-levels'] });
  };

  // Inline quick-adjust (+1 / −1). Runs an /inventory/adjust with a single line.
  const quickAdjust = useMutation({
    mutationFn: async ({ row, delta }: { row: StockLevelRow; delta: number }) =>
      adjustStock({
        store_id: row.store_id,
        reason: delta > 0 ? 'Quick +1 (inventory grid)' : 'Quick −1 (inventory grid)',
        lines: [{ variant_id: row.variant_id, delta: delta.toFixed(3) }],
      }),
    onSuccess: invalidate,
  });

  // Scanner behavior — barcode scanners fire the string + Enter faster than
  // React can flush the controlled-input state. Read the live DOM value so
  // we don't match against a stale `scanBuffer`. Match SKU/barcode against
  // visible rows; if found, open the Receive modal for that row with the
  // cursor in the qty field.
  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = (e.currentTarget.value ?? scanBuffer).trim();
    if (!raw) return;
    const q = raw.toLowerCase();
    const match =
      rows.find((r) => r.sku.toLowerCase() === q) ??
      rows.find((r) => (r.barcode ?? '').toLowerCase() === q) ??
      rows.find(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          (r.barcode ?? '').toLowerCase().includes(q),
      );
    if (match) {
      setScanBuffer('');
      setOpenReceive(match);
    } else {
      // No local match — fall through to the search filter so the operator
      // can see the query in context.
      setSearch(raw);
      setScanBuffer('');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Every variant in your catalog with its live stock, per store. Scan to receive, or use +/− to nudge counts."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              leadingIcon={<Layers className="h-4 w-4" />}
              onClick={() => setOpenBulk(true)}
            >
              Bulk receive
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<ArrowRightLeft className="h-4 w-4" />}
              onClick={() => setOpenTransfer(true)}
            >
              Transfer
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<Wrench className="h-4 w-4" />}
              onClick={() => setOpenAdjust(true)}
            >
              Adjust
            </Button>
            <Button
              leadingIcon={<PackagePlus className="h-4 w-4" />}
              onClick={() => setOpenReceive('blank')}
            >
              Receive stock
            </Button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="Variants" value={String(stats.total)} icon={Boxes} />
        <SummaryTile label="In stock" value={String(stats.inStock)} icon={PackagePlus} tone="emerald" />
        <SummaryTile label="Low stock" value={String(stats.low)} icon={Wrench} tone="amber" />
        <SummaryTile label="Out of stock" value={String(stats.out)} icon={X} tone="rose" />
      </div>

      {/* Scanner + filter bar */}
      <GlassCard className="p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px_220px]">
          <Input
            ref={scanRef}
            label="Scan or type SKU / barcode → Enter"
            placeholder="Scan the barcode; a matching row opens the Receive dialog"
            leadingIcon={<ScanBarcode className="h-4 w-4" />}
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
            onKeyDown={onScanKey}
            autoComplete="off"
          />
          <Select
            label="Store"
            placeholder="— Select store —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`,
              value: s.id,
            }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          <Input
            label="Search"
            placeholder="Name, SKU, barcode"
            leadingIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={filter === ''} onClick={() => setFilter('')}>
            All
          </Chip>
          <Chip
            active={filter === 'in_stock'}
            onClick={() => setFilter('in_stock')}
            tone="emerald"
          >
            In stock
          </Chip>
          <Chip active={filter === 'low_stock'} onClick={() => setFilter('low_stock')} tone="amber">
            Low stock
          </Chip>
          <Chip
            active={filter === 'out_of_stock'}
            onClick={() => setFilter('out_of_stock')}
            tone="rose"
          >
            Out of stock
          </Chip>
        </div>
      </GlassCard>

      {levelsQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {levelsQuery.error instanceof ApiError
            ? levelsQuery.error.message
            : 'Failed to load stock levels.'}
        </div>
      )}

      {/* Grid */}
      <GlassCard className="p-0">
        {!storeId ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            Pick a store to see its stock.
          </div>
        ) : levelsQuery.isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400">Loading stock…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No products match this filter. Try switching to <em>All</em>, or add products from the
            Catalog.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr className="border-b border-border/60">
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">SKU · Barcode</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                  <th className="px-3 py-2 text-right">Reorder pt.</th>
                  <th className="px-3 py-2 text-right">Quick adjust</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = Number(r.quantity);
                  const rp = Number(r.reorder_point);
                  const state: 'out' | 'low' | 'ok' =
                    q <= 0 ? 'out' : rp > 0 && q <= rp ? 'low' : 'ok';
                  return (
                    <tr
                      key={`${r.variant_id}-${r.store_id}`}
                      className="border-b border-border/40 align-middle last:border-b-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
                            <Boxes className="h-4 w-4" />
                          </span>
                          <div>
                            <div className="font-medium text-white">{r.product_name}</div>
                            <div className="text-[11px] text-slate-500">{r.variant_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs text-slate-300">{r.sku}</div>
                        {r.barcode && (
                          <div className="font-mono text-[10px] text-slate-500">{r.barcode}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-400">
                        {r.unit_symbol}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div
                          className={cn(
                            'font-mono text-sm font-semibold',
                            state === 'out'
                              ? 'text-rose-300'
                              : state === 'low'
                                ? 'text-amber-300'
                                : 'text-slate-100',
                          )}
                        >
                          {r.quantity} {r.unit_symbol}
                        </div>
                        {state !== 'ok' && (
                          <div
                            className={cn(
                              'text-[10px] uppercase tracking-wider',
                              state === 'out' ? 'text-rose-400' : 'text-amber-400',
                            )}
                          >
                            {state === 'out' ? 'Out of stock' : 'Low stock'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                        {rp > 0 ? r.reorder_point : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <IconBtn
                            title="−1"
                            onClick={() =>
                              void quickAdjust.mutateAsync({ row: r, delta: -1 })
                            }
                            disabled={q <= 0}
                          >
                            <Minus className="h-3 w-3" />
                          </IconBtn>
                          <IconBtn
                            title="+1"
                            onClick={() =>
                              void quickAdjust.mutateAsync({ row: r, delta: 1 })
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </IconBtn>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button size="sm" onClick={() => setOpenReceive(r)}>
                            Receive
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Ledger history"
                            onClick={() => setOpenHistory(r)}
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <ReceiveModal
        open={openReceive !== null}
        preRow={openReceive === 'blank' || openReceive === null ? null : openReceive}
        defaultStoreId={storeId}
        stores={storesQuery.data?.items ?? []}
        onClose={() => setOpenReceive(null)}
        onDone={() => {
          setOpenReceive(null);
          invalidate();
        }}
      />

      <BulkReceiveModal
        open={openBulk}
        defaultStoreId={storeId}
        stores={storesQuery.data?.items ?? []}
        onClose={() => setOpenBulk(false)}
        onDone={() => {
          setOpenBulk(false);
          invalidate();
        }}
      />

      <AdjustModal
        open={openAdjust}
        defaultStoreId={storeId}
        stores={storesQuery.data?.items ?? []}
        onClose={() => setOpenAdjust(false)}
        onDone={() => {
          setOpenAdjust(false);
          invalidate();
        }}
      />

      <TransferModal
        open={openTransfer}
        stores={storesQuery.data?.items ?? []}
        onClose={() => setOpenTransfer(false)}
        onDone={() => {
          setOpenTransfer(false);
          invalidate();
        }}
      />

      <HistoryDrawer row={openHistory} onClose={() => setOpenHistory(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation bits
// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'emerald' | 'amber' | 'rose';
}): JSX.Element {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </div>
          <div
            className={cn(
              'mt-1 font-mono text-2xl font-semibold',
              tone === 'emerald'
                ? 'text-emerald-200'
                : tone === 'amber'
                  ? 'text-amber-200'
                  : tone === 'rose'
                    ? 'text-rose-200'
                    : 'text-white',
            )}
          >
            {value}
          </div>
        </div>
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border',
            tone === 'emerald'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : tone === 'amber'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : tone === 'rose'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  : 'border-border bg-white/[0.03] text-slate-300',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </GlassCard>
  );
}

function Chip({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: 'emerald' | 'amber' | 'rose';
}): JSX.Element {
  const activeCls =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
      : tone === 'amber'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
        : tone === 'rose'
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          : 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-100';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? activeCls : 'border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]',
      )}
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white/[0.02] text-slate-300 transition-colors',
        disabled ? 'opacity-40' : 'hover:bg-white/[0.05] hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variant picker — used by every modal that needs to select a variant
// ---------------------------------------------------------------------------

/**
 * Fetches every active variant from the catalog and exposes a search-as-you-type
 * dropdown. Also accepts a barcode scanner (Enter selects the exact match).
 */
function useCatalogVariants(): { data: CatalogVariant[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['catalog-variants', 'inventory'],
    queryFn: async (): Promise<CatalogVariant[]> => {
      const summaries = await listProducts({ page_size: 500, is_active: true });
      const out: CatalogVariant[] = [];
      for (const s of summaries.items) {
        const full = await getProduct(s.id);
        for (const v of full.variants) {
          if (!v.is_active) continue;
          out.push({
            variant_id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            product_name: full.name,
            variant_name: v.name,
            unit_symbol: '',
          });
        }
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
  return { data: query.data ?? [], isLoading: query.isLoading };
}

function VariantPicker({
  value,
  onSelect,
  autoFocus,
}: {
  value: CatalogVariant | null;
  onSelect: (v: CatalogVariant | null) => void;
  autoFocus?: boolean;
}): JSX.Element {
  const { data: variants, isLoading } = useCatalogVariants();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return variants.slice(0, 20);
    return variants
      .filter((v) => {
        const hay =
          `${v.product_name} ${v.variant_name} ${v.sku} ${v.barcode ?? ''}`.toLowerCase();
        return hay.includes(query);
      })
      .slice(0, 20);
  }, [q, variants]);

  useEffect(() => setActive(0), [q]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Live DOM value beats React state when a scanner is typing at
      // ~200 chars/sec — the setState from the last keystroke won't have
      // flushed by the time Enter fires.
      const raw = (e.currentTarget.value ?? q).trim();
      if (!raw) return;
      const query = raw.toLowerCase();
      const exact = variants.find(
        (v) =>
          v.sku.toLowerCase() === query || (v.barcode ?? '').toLowerCase() === query,
      );
      if (exact) {
        onSelect(exact);
        setQ('');
        setOpen(false);
        return;
      }
      // Partial fallback so a shorter scan or manual typing still works.
      const partial = variants.find((v) => {
        const hay = `${v.product_name} ${v.variant_name} ${v.sku} ${v.barcode ?? ''}`
          .toLowerCase();
        return hay.includes(query);
      });
      if (partial) {
        onSelect(partial);
        setQ('');
        setOpen(false);
        return;
      }
      if (filtered[active]) {
        onSelect(filtered[active]);
        setQ('');
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-cobalt-500/30 bg-cobalt-500/10 px-3 py-2 text-sm">
          <div>
            <div className="font-medium text-white">{value.product_name}</div>
            <div className="text-[11px] text-slate-400">
              {value.variant_name} · <span className="font-mono">{value.sku}</span>
              {value.barcode && (
                <>
                  {' · '}
                  <span className="font-mono">{value.barcode}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:text-white"
            onClick={() => onSelect(null)}
            title="Change variant"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <Input
            ref={inputRef}
            label="Product / variant"
            placeholder={
              isLoading
                ? 'Loading catalog…'
                : 'Scan barcode · type SKU · search by name'
            }
            leadingIcon={<ScanBarcode className="h-4 w-4" />}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            autoComplete="off"
          />
          {open && filtered.length > 0 && (
            <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border-strong bg-ink-900 shadow-glass-lg">
              {filtered.map((v, idx) => (
                <li
                  key={v.variant_id}
                  onClick={() => {
                    onSelect(v);
                    setQ('');
                    setOpen(false);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between border-b border-border/40 px-3 py-2 text-sm last:border-b-0',
                    idx === active ? 'bg-cobalt-500/10' : 'hover:bg-white/[0.03]',
                  )}
                >
                  <div>
                    <div className="text-white">{v.product_name}</div>
                    <div className="text-[11px] text-slate-500">
                      {v.variant_name} · <span className="font-mono">{v.sku}</span>
                      {v.barcode && (
                        <>
                          {' · '}
                          <span className="font-mono">{v.barcode}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receive modal — one variant, one store, positive qty
// ---------------------------------------------------------------------------

interface StoreLike {
  id: string;
  code: string;
  name: string;
}

function ReceiveModal({
  open,
  preRow,
  defaultStoreId,
  stores,
  onClose,
  onDone,
}: {
  open: boolean;
  preRow: StockLevelRow | null;
  defaultStoreId: string;
  stores: StoreLike[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [storeId, setStoreId] = useState<string>(defaultStoreId);
  const [variant, setVariant] = useState<CatalogVariant | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStoreId(preRow?.store_id ?? defaultStoreId);
    setVariant(
      preRow
        ? {
            variant_id: preRow.variant_id,
            sku: preRow.sku,
            barcode: preRow.barcode,
            product_name: preRow.product_name,
            variant_name: preRow.variant_name,
            unit_symbol: preRow.unit_symbol,
          }
        : null,
    );
    setQty('1');
    setCost('');
    setNote('');
    setError(null);
  }, [open, preRow, defaultStoreId]);

  const submit = useMutation({
    mutationFn: () =>
      adjustStock({
        store_id: storeId,
        reason: note.trim()
          ? `STOCK RECEIPT: ${note.trim()}`
          : 'STOCK RECEIPT',
        lines: [
          {
            variant_id: variant!.variant_id,
            delta: (Number(qty) || 0).toFixed(3),
            unit_cost: cost.trim() || null,
          },
        ],
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to receive stock.'),
  });

  const qtyNum = Number(qty) || 0;
  const invalid = !storeId || !variant || qtyNum <= 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive stock"
      description="Record incoming units for one variant. Runs as a stock adjustment on the append-only ledger."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Store"
            placeholder="— Select store —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          {preRow && (
            <div className="rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs">
              <div className="uppercase tracking-wider text-slate-500">Current on hand</div>
              <div className="mt-1 font-mono text-lg text-white">
                {preRow.quantity} {preRow.unit_symbol}
              </div>
            </div>
          )}
        </div>

        <VariantPicker value={variant} onSelect={setVariant} autoFocus={!preRow} />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Quantity${variant ? ` (${variant.unit_symbol || 'units'})` : ''}`}
            type="number"
            step="0.001"
            min="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Unit cost (optional)"
            type="number"
            step="0.01"
            min="0"
            placeholder="What you paid per unit"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>

        <Textarea
          label="Note"
          rows={2}
          placeholder="Optional — invoice #, supplier name, etc."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            disabled={invalid || submit.isPending}
            loading={submit.isPending}
            leadingIcon={<PackagePlus className="h-4 w-4" />}
            onClick={() => submit.mutate()}
          >
            Receive {qtyNum > 0 ? `${qty} ${variant?.unit_symbol ?? ''}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bulk Receive modal — scan / add many, submit as one atomic adjustment
// ---------------------------------------------------------------------------

interface BulkLine extends CatalogVariant {
  qty: string;
  cost: string;
}

function BulkReceiveModal({
  open,
  defaultStoreId,
  stores,
  onClose,
  onDone,
}: {
  open: boolean;
  defaultStoreId: string;
  stores: StoreLike[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [storeId, setStoreId] = useState<string>(defaultStoreId);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<BulkLine[]>([]);
  const [picker, setPicker] = useState<CatalogVariant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStoreId(defaultStoreId);
    setNote('');
    setLines([]);
    setPicker(null);
    setError(null);
  }, [open, defaultStoreId]);

  // When the picker resolves a variant, auto-add it as a new line and clear.
  useEffect(() => {
    if (!picker) return;
    setLines((ls) => {
      const dup = ls.find((l) => l.variant_id === picker.variant_id);
      if (dup) {
        return ls.map((l) =>
          l.variant_id === picker.variant_id
            ? { ...l, qty: String((Number(l.qty) || 0) + 1) }
            : l,
        );
      }
      return [...ls, { ...picker, qty: '1', cost: '' }];
    });
    setPicker(null);
  }, [picker]);

  const submit = useMutation({
    mutationFn: () => {
      const bodyLines: AdjustmentLine[] = lines.map((l) => ({
        variant_id: l.variant_id,
        delta: (Number(l.qty) || 0).toFixed(3),
        unit_cost: l.cost.trim() || null,
      }));
      return adjustStock({
        store_id: storeId,
        reason: note.trim() ? `BULK RECEIPT: ${note.trim()}` : 'BULK RECEIPT',
        lines: bodyLines,
      });
    },
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to receive stock.'),
  });

  const validLines = lines.filter((l) => (Number(l.qty) || 0) > 0);
  const invalid = !storeId || validLines.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk receive"
      description="Scan or add many products in one shot. All lines post as a single atomic adjustment — either they all land, or none do."
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Store"
            placeholder="— Select store —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          <Input
            label="Note (optional)"
            placeholder="Supplier · invoice #"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <VariantPicker value={picker} onSelect={setPicker} />

        <div className="rounded-xl border border-border">
          <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
            Lines ({lines.length})
          </div>
          {lines.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500">
              Scan a barcode or search a product above to add it here.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                  <tr className="border-b border-border/60">
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit cost</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.variant_id} className="border-b border-border/40 last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="text-white">{l.product_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {l.variant_name} · <span className="font-mono">{l.sku}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={l.qty}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((x) =>
                                x.variant_id === l.variant_id
                                  ? { ...x, qty: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className="w-24 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-cobalt-400 focus:outline-none focus:ring-1 focus:ring-cobalt-400/40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="—"
                          value={l.cost}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((x) =>
                                x.variant_id === l.variant_id
                                  ? { ...x, cost: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className="w-24 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-cobalt-400 focus:outline-none focus:ring-1 focus:ring-cobalt-400/40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((ls) =>
                              ls.filter((x) => x.variant_id !== l.variant_id),
                            )
                          }
                          className="text-slate-500 hover:text-rose-300"
                          title="Remove line"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            disabled={invalid || submit.isPending}
            loading={submit.isPending}
            leadingIcon={<Layers className="h-4 w-4" />}
            onClick={() => submit.mutate()}
          >
            Receive {validLines.length} line{validLines.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Adjust modal — signed delta with reason (breakage, cycle count, opening)
// ---------------------------------------------------------------------------

function AdjustModal({
  open,
  defaultStoreId,
  stores,
  onClose,
  onDone,
}: {
  open: boolean;
  defaultStoreId: string;
  stores: StoreLike[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [storeId, setStoreId] = useState<string>(defaultStoreId);
  const [variant, setVariant] = useState<CatalogVariant | null>(null);
  const [delta, setDelta] = useState('0');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStoreId(defaultStoreId);
    setVariant(null);
    setDelta('0');
    setCost('');
    setReason('');
    setError(null);
  }, [open, defaultStoreId]);

  const submit = useMutation({
    mutationFn: () =>
      adjustStock({
        store_id: storeId,
        reason: reason.trim(),
        lines: [
          {
            variant_id: variant!.variant_id,
            delta: (Number(delta) || 0).toFixed(3),
            unit_cost: cost.trim() || null,
          },
        ],
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to post adjustment.'),
  });

  const invalid =
    !storeId || !variant || !reason.trim() || (Number(delta) || 0) === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock adjustment"
      description='Signed delta. Positive adds, negative removes. Prefix the reason with "OPENING" to allow the balance to go negative (opening balance flow).'
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Store"
            placeholder="— Select store —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          <div />
        </div>
        <VariantPicker value={variant} onSelect={setVariant} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Delta"
            type="number"
            step="0.001"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            hint="Positive = add · Negative = remove"
          />
          <Input
            label="Unit cost (optional)"
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
        <Input
          label="Reason"
          placeholder='e.g. "Breakage", "Cycle count correction", "OPENING BALANCE"'
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            disabled={invalid || submit.isPending}
            loading={submit.isPending}
            leadingIcon={<Wrench className="h-4 w-4" />}
            onClick={() => submit.mutate()}
          >
            Post adjustment
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transfer modal
// ---------------------------------------------------------------------------

function TransferModal({
  open,
  stores,
  onClose,
  onDone,
}: {
  open: boolean;
  stores: StoreLike[];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [variant, setVariant] = useState<CatalogVariant | null>(null);
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFromId('');
    setToId('');
    setVariant(null);
    setQty('1');
    setReason('');
    setError(null);
  }, [open]);

  const submit = useMutation({
    mutationFn: () =>
      transferStock({
        from_store_id: fromId,
        to_store_id: toId,
        reason: reason.trim() || null,
        lines: [
          { variant_id: variant!.variant_id, delta: (Number(qty) || 0).toFixed(3) },
        ],
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to transfer stock.'),
  });

  const invalid =
    !fromId ||
    !toId ||
    fromId === toId ||
    !variant ||
    (Number(qty) || 0) <= 0;

  return (
    <Modal open={open} onClose={onClose} title="Stock transfer" size="lg"
      description="Move stock from one store to another. Both legs post together — the ledger stays consistent.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="From store"
            placeholder="— Source —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
          />
          <Select
            label="To store"
            placeholder="— Destination —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
          />
        </div>
        <VariantPicker value={variant} onSelect={setVariant} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quantity"
            type="number"
            step="0.001"
            min="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Input
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {fromId && toId && fromId === toId && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Source and destination must differ.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            disabled={invalid || submit.isPending}
            loading={submit.isPending}
            leadingIcon={<ArrowRightLeft className="h-4 w-4" />}
            onClick={() => submit.mutate()}
          >
            Post transfer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// History drawer — recent ledger entries for a (variant, store)
// ---------------------------------------------------------------------------

function HistoryDrawer({
  row,
  onClose,
}: {
  row: StockLevelRow | null;
  onClose: () => void;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['inventory-movements', row?.variant_id, row?.store_id],
    queryFn: () =>
      listMovements({
        variant_id: row!.variant_id,
        store_id: row!.store_id,
        page_size: 100,
      }),
    enabled: !!row,
  });

  if (!row) return null;

  return (
    <Modal open={!!row} onClose={onClose} title="Stock ledger" size="lg"
      description={`${row.product_name} · ${row.variant_name} · at ${row.store_code}`}>
      <div className="max-h-[60vh] overflow-y-auto">
        {query.isLoading && (
          <div className="py-8 text-center text-sm text-slate-400">Loading history…</div>
        )}
        {query.isError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Failed to load ledger.
          </div>
        )}
        {query.data && query.data.items.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            No movements yet. Receive some stock and it'll appear here.
          </div>
        )}
        {query.data && query.data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr className="border-b border-border/60">
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-right">Delta</th>
                <th className="px-3 py-2 text-right">Balance after</th>
                <th className="px-3 py-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((m) => {
                const delta = Number(m.delta);
                return (
                  <tr key={m.id} className="border-b border-border/40 last:border-b-0">
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md border border-border bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
                        {MOVEMENT_LABEL[m.kind]}
                      </span>
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono',
                        delta >= 0 ? 'text-emerald-300' : 'text-rose-300',
                      )}
                    >
                      {delta >= 0 ? '+' : ''}
                      {m.delta}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-200">
                      {m.balance_after}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{m.reason ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
