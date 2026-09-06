/**
 * Physical stock audit — the sheet, on screen.
 *
 * THE GO-LIVE BLOCKER. The legacy import brought over products and variants
 * but deliberately NOT stock, because the old system's quantities could not be
 * trusted. Every variant reads zero until somebody walks the floor, so until a
 * count is posted no stock figure in this software means anything.
 *
 * WHAT THIS SCREEN IS FOR
 * Somebody standing at a rack with a scanner in one hand. That shapes every
 * decision here: scan → type a number → Enter → next item, with the hands
 * never leaving the keyboard and the input never losing focus. A form that
 * needs a mouse between items turns a 300-item section into an afternoon.
 *
 * WHY THE EXPECTED QUANTITY IS USUALLY NOT SHOWN
 * A blind count hides what the books say. Shown the figure they are supposed
 * to find, a tired person at the end of a shift writes it down instead of
 * counting, and the sheet comes back with a perfect zero variance that proves
 * nothing. The server withholds it — this screen could not show it even if it
 * wanted to — and releases it once the sheet is posted, when it becomes the
 * audit record a manager has to review.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { stockLevels, type StockLevelRow } from '@/lib/inventory-api';
import { listStores } from '@/lib/stores-api';
import {
  cancelStockCount,
  createStockCount,
  deleteStockCountLine,
  getStockCount,
  listStockCounts,
  postStockCount,
  saveStockCountLines,
  type StockCountPostResult,
  // Aliased: the page component is also called StockCount, and the shadowing
  // is exactly the kind of thing that reads fine now and confuses whoever
  // adds the next field.
  type StockCount as StockCountSheet,
} from '@/lib/stock-count-api';

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function StockCount(): JSX.Element {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [posted, setPosted] = useState<StockCountPostResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const stores = storesQuery.data?.items ?? [];

  useEffect(() => {
    if (!storeId && stores.length) setStoreId(stores[0].id);
  }, [storeId, stores]);

  const sheetsQuery = useQuery({
    queryKey: ['stock-counts', storeId],
    queryFn: () => listStockCounts({ store_id: storeId }),
    enabled: Boolean(storeId),
  });

  const sheetQuery = useQuery({
    queryKey: ['stock-count', activeId],
    queryFn: () => getStockCount(activeId!),
    enabled: Boolean(activeId),
  });
  const sheet = sheetQuery.data;

  // The catalogue for this branch, used to turn a scanned barcode into a
  // variant. Loaded once for the whole sheet: a counter works through a rack
  // fast, and a lookup request per scan would stall on a shop's connection at
  // exactly the wrong moment.
  const catalogQuery = useQuery({
    queryKey: ['stock-count-catalog', storeId],
    queryFn: () => stockLevels({ store_id: storeId, page_size: 1000 }),
    enabled: Boolean(storeId),
    staleTime: 5 * 60_000,
  });
  const catalog = catalogQuery.data?.items ?? [];

  const create = useMutation({
    mutationFn: (body: { reference: string; scope: string; is_blind: boolean }) =>
      createStockCount({ store_id: storeId, ...body }),
    onSuccess: (c) => {
      setCreating(false);
      setActiveId(c.id);
      void qc.invalidateQueries({ queryKey: ['stock-counts'] });
    },
    onError: (e) => setError(errorText(e, 'Could not open the count sheet.')),
  });

  const saveLines = useMutation({
    mutationFn: (line: { variant_id: string; counted_qty: string; reason?: string }) =>
      saveStockCountLines(activeId!, [line]),
    onSuccess: (c) => {
      qc.setQueryData(['stock-count', activeId], c);
      setError(null);
    },
    onError: (e) => setError(errorText(e, 'Could not save that count.')),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => deleteStockCountLine(activeId!, lineId),
    onSuccess: (c) => qc.setQueryData(['stock-count', activeId], c),
  });

  const post = useMutation({
    mutationFn: () => postStockCount(activeId!),
    onSuccess: (res) => {
      setPosted(res);
      void qc.invalidateQueries({ queryKey: ['stock-count', activeId] });
      void qc.invalidateQueries({ queryKey: ['stock-counts'] });
      // The whole point: stock has moved. Anything showing a balance is stale.
      void qc.invalidateQueries({ queryKey: ['stock-levels'] });
    },
    onError: (e) => setError(errorText(e, 'Could not post the count.')),
  });

  const cancel = useMutation({
    mutationFn: () => cancelStockCount(activeId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock-count', activeId] });
      void qc.invalidateQueries({ queryKey: ['stock-counts'] });
    },
  });

  if (sheet) {
    return (
      <CountSheet
        sheet={sheet}
        catalog={catalog}
        error={error}
        onError={setError}
        onBack={() => {
          setActiveId(null);
          setPosted(null);
          setError(null);
        }}
        onSaveLine={(line) => saveLines.mutate(line)}
        onRemoveLine={(id) => removeLine.mutate(id)}
        onPost={() => post.mutate()}
        onCancelSheet={() => cancel.mutate()}
        posting={post.isPending}
        posted={posted}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock count"
        description="Count what is on the shelf, and correct the books."
        actions={
          <Button
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={() => setCreating(true)}
            disabled={!storeId}
          >
            New count
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <GlassCard className="p-4">
        <Select
          label="Branch"
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            setActiveId(null);
          }}
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
          hint="Stock is counted per branch. The two malls file separately."
        />
      </GlassCard>

      {/* A failed request must never render as "no counts yet" — somebody
          reading that will start the whole sheet again from scratch. */}
      {sheetsQuery.isError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Could not load the count sheets.
        </div>
      ) : (
        <GlassCard className="divide-y divide-border">
          {(sheetsQuery.data ?? []).length === 0 ? (
            <div className="space-y-2 p-8 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-slate-500" />
              <p className="text-sm text-slate-300">No counts at this branch yet.</p>
              <p className="mx-auto max-w-md text-xs text-slate-500">
                Stock figures start at zero because the old system&apos;s
                quantities were not imported. A count is what makes them real.
              </p>
            </div>
          ) : (
            (sheetsQuery.data ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-slate-100">
                    <span className="font-medium">{s.reference}</span>
                    {s.is_blind && (
                      <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                        blind
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {s.scope ?? 'Whole shop'} · {s.line_count} item
                    {s.line_count === 1 ? '' : 's'}
                  </div>
                </div>
                <StatusChip status={s.status} />
              </button>
            ))
          )}
        </GlassCard>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New stock count">
        <NewCountForm
          onCancel={() => setCreating(false)}
          onSubmit={(body) => create.mutate(body)}
          busy={create.isPending}
        />
      </Modal>
    </div>
  );
}

function StatusChip({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'posted'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'cancelled'
        ? 'border-slate-600 bg-white/5 text-slate-400'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return (
    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', tone)}>
      {status === 'draft' ? 'counting' : status}
    </span>
  );
}

function NewCountForm({
  onCancel,
  onSubmit,
  busy,
}: {
  onCancel: () => void;
  onSubmit: (body: { reference: string; scope: string; is_blind: boolean }) => void;
  busy: boolean;
}): JSX.Element {
  // Today's date pre-filled, because that is what every sheet is named after
  // and typing it is pure friction.
  const today = new Date().toISOString().slice(0, 10);
  const [reference, setReference] = useState(`COUNT-${today}`);
  const [scope, setScope] = useState('');
  const [isBlind, setIsBlind] = useState(true);

  return (
    <div className="space-y-4">
      <Input
        label="Sheet reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        hint="How this sheet will be referred to later. Unique per branch."
      />
      <Input
        label="What is being counted"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        placeholder="Sarees, ground floor"
        hint="Optional. A count of one section is normal — nothing outside it is touched."
      />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          checked={isBlind}
          onChange={(e) => setIsBlind(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-sm">
          <span className="flex items-center gap-2 text-slate-100">
            {isBlind ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Blind count
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            Hides what the books say until the sheet is posted. Shown the
            expected figure, it is very easy to write it down instead of
            counting — and a sheet like that proves nothing.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => onSubmit({ reference: reference.trim(), scope: scope.trim(), is_blind: isBlind })}
          disabled={busy || !reference.trim()}
        >
          Start counting
        </Button>
      </div>
    </div>
  );
}

interface CountSheetProps {
  sheet: StockCountSheet;
  catalog: StockLevelRow[];
  error: string | null;
  onError: (msg: string | null) => void;
  onBack: () => void;
  onSaveLine: (line: { variant_id: string; counted_qty: string; reason?: string }) => void;
  onRemoveLine: (lineId: string) => void;
  onPost: () => void;
  onCancelSheet: () => void;
  posting: boolean;
  posted: StockCountPostResult | null;
}

function CountSheet({
  sheet,
  catalog,
  error,
  onError,
  onBack,
  onSaveLine,
  onRemoveLine,
  onPost,
  onCancelSheet,
  posting,
  posted,
}: CountSheetProps): JSX.Element {
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('');
  const [picked, setPicked] = useState<StockLevelRow | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const open = sheet.status === 'draft';

  // Focus returns to the scan box after every entry. Somebody at a rack has a
  // scanner in one hand and should never have to reach for the mouse.
  useEffect(() => {
    if (open) codeRef.current?.focus();
  }, [open]);

  const byCode = useMemo(() => {
    const map = new Map<string, StockLevelRow>();
    for (const row of catalog) {
      // Barcode FIRST and separately from SKU: a scanner emits a barcode, and
      // when one string is one variant's barcode and another's SKU the
      // scanner's reading has to win. Same precedence as the billing screen.
      if (row.barcode) map.set(row.barcode.toLowerCase(), row);
    }
    for (const row of catalog) {
      const key = row.sku.toLowerCase();
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [catalog]);

  function resolve(raw: string): void {
    const query = raw.trim().toLowerCase();
    if (!query) return;
    const hit = byCode.get(query);
    if (!hit) {
      onError(`Nothing in this branch's catalogue matches "${raw.trim()}".`);
      return;
    }
    onError(null);
    setPicked(hit);
    setCode('');
    // Straight to the quantity — the next thing the counter types.
    window.setTimeout(() => qtyRef.current?.focus(), 0);
  }

  function commit(): void {
    if (!picked) return;
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) {
      onError('Enter how many are actually on the shelf. A shelf cannot hold less than none.');
      return;
    }
    onSaveLine({ variant_id: picked.variant_id, counted_qty: n.toFixed(3) });
    setPicked(null);
    setQty('');
    codeRef.current?.focus();
  }

  const counted = sheet.lines.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sheet.reference}
        description={sheet.scope ?? 'Whole shop'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            {open && (
              <>
                <Button variant="ghost" onClick={onCancelSheet}>
                  Abandon
                </Button>
                <Button
                  leadingIcon={<Check className="h-4 w-4" />}
                  onClick={onPost}
                  disabled={posting || counted === 0}
                >
                  Post {counted} item{counted === 1 ? '' : 's'}
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      {posted && <PostedSummary result={posted} />}

      {open && (
        <GlassCard className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Input
              ref={codeRef}
              label="Scan or type a code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  resolve(code);
                }
              }}
              placeholder="Barcode or SKU"
            />
            <Input
              ref={qtyRef}
              label="Counted"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
              inputMode="decimal"
              placeholder="0"
              disabled={!picked}
            />
          </div>

          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-cobalt-500/30 bg-cobalt-500/10 px-3 py-2 text-sm">
              <span className="truncate text-slate-100">
                {picked.product_name}
                <span className="text-slate-400"> · {picked.variant_name}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{picked.sku}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">
                Type the count, then Enter
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Scan an item, type how many are on the shelf, press Enter. The
              cursor comes back here for the next one.
            </p>
          )}

          {sheet.is_blind && (
            <p className="flex items-center gap-2 text-xs text-amber-300/80">
              <EyeOff className="h-3.5 w-3.5 shrink-0" />
              Blind count — what the books say is hidden until this sheet is
              posted.
            </p>
          )}
        </GlassCard>
      )}

      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">Counted</th>
                <th className="px-4 py-2 text-right">Books said</th>
                <th className="px-4 py-2 text-right">Difference</th>
                {open && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sheet.lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    Nothing counted yet.
                  </td>
                </tr>
              ) : (
                sheet.lines.map((line) => {
                  const variance = line.variance === null ? null : Number(line.variance);
                  return (
                    <tr key={line.id}>
                      <td className="px-4 py-2">
                        <div className="text-slate-100">{line.product_name ?? '—'}</div>
                        <div className="text-xs text-slate-500">
                          {line.variant_label}
                          {line.sku ? ` · ${line.sku}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-100">
                        {Number(line.counted_qty)}
                      </td>
                      {/* An em dash, not a zero. "Withheld" and "the books say
                          nothing is here" are different facts, and a zero in
                          this column during a blind count would be a lie. */}
                      <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                        {line.system_qty === null ? '—' : Number(line.system_qty)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-right tabular-nums',
                          variance === null || variance === 0
                            ? 'text-slate-500'
                            : variance > 0
                              ? 'text-emerald-300'
                              : 'text-rose-300',
                        )}
                      >
                        {variance === null
                          ? '—'
                          : variance === 0
                            ? '✓'
                            : `${variance > 0 ? '+' : ''}${variance}`}
                      </td>
                      {open && (
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            title="Remove this line"
                            onClick={() => onRemoveLine(line.id)}
                            className="rounded-md p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Only items ON this sheet are touched. Said on the screen, because a
          manager about to post is entitled to know the shirts they did not
          look at are not about to be written off. */}
      {open && counted > 0 && (
        <p className="text-xs text-slate-500">
          Posting corrects only these {counted} item{counted === 1 ? '' : 's'}.
          Anything not counted here is left exactly as it is.
        </p>
      )}
    </div>
  );
}

function PostedSummary({ result }: { result: StockCountPostResult }): JSX.Element {
  const net = Number(result.net_variance);
  return (
    <GlassCard className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm text-emerald-300">
        <Check className="h-4 w-4" />
        Posted. {result.movements_posted} correction
        {result.movements_posted === 1 ? '' : 's'} written to the stock ledger.
      </div>
      <div className="text-sm text-slate-300">
        Net change:{' '}
        <span
          className={cn(
            'font-semibold tabular-nums',
            net === 0 ? 'text-slate-400' : net > 0 ? 'text-emerald-300' : 'text-rose-300',
          )}
        >
          {net > 0 ? '+' : ''}
          {net}
        </span>{' '}
        units
      </div>

      {/* Not an error. But a manager reviewing a big discrepancy should know
          the shelf was being sold from while it was being counted. */}
      {result.drifted_variant_ids.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {result.drifted_variant_ids.length} item
            {result.drifted_variant_ids.length === 1 ? '' : 's'} moved between
            being counted and being posted — sold, received, or transferred.
            The correction was applied on top of that movement, which is
            right, but the difference shown was measured earlier.
          </span>
        </div>
      )}
    </GlassCard>
  );
}
