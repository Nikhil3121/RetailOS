/**
 * Credit part or all of a bill.
 *
 * A return is ALWAYS against one specific invoice, which is why this is its own
 * screen rather than a mode on the cart. The cart answers "what is this
 * customer buying"; a return answers "which of these particular lines is coming
 * back", and the two need opposite layouts.
 *
 * Nothing here computes money. Quantities are chosen, the server copies and
 * scales every figure from the original line, and the credit note it returns is
 * displayed as-is — so a credit note can never disagree with the invoice it
 * reverses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Minus, Plus, RotateCcw, ScanBarcode, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  createSaleReturn,
  getReturnableLines,
  getSale,
  type PaymentMethod,
  type ReturnableLine,
} from '@/lib/sales-api';
import { cn } from '@/lib/cn';

const REFUND_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'Card', value: 'card' },
  { label: 'UPI', value: 'upi' },
  { label: 'Other', value: 'other' },
];

export function SaleReturn(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const saleQuery = useQuery({
    queryKey: ['sale', id],
    queryFn: () => getSale(id!),
    enabled: !!id,
  });
  const linesQuery = useQuery({
    queryKey: ['sale-returnable', id],
    queryFn: () => getReturnableLines(id!),
    enabled: !!id,
  });

  /** Units being returned, keyed by original sale line. Positive throughout. */
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [refundAmount, setRefundAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows = linesQuery.data ?? [];

  /**
   * The credit this return is worth, at the original line's rate.
   *
   * DISPLAY ONLY — the server recomputes it by scaling the stored line, which
   * is the figure that actually gets written. This is here so the cashier can
   * see roughly what they are about to credit before pressing the button.
   */
  const estimate = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const n = Number(qty[r.sale_line_id] ?? 0);
        if (!n) return sum;
        return sum + n * Number(r.unit_price);
      }, 0),
    [rows, qty],
  );

  // Default the refund to the full credit — the common case is handing back
  // exactly what the customer paid for those items.
  useEffect(() => {
    setRefundAmount(estimate > 0 ? estimate.toFixed(2) : '');
  }, [estimate]);

  const chosen = rows.filter((r) => Number(qty[r.sale_line_id] ?? 0) > 0);

  /* ---------------------------------------------------------------------
   * Smart input.
   *
   * A return at a counter starts with the customer putting an item on the
   * desk, not with anyone typing a number. So the fast path is: scan it. The
   * slow paths — stepper, "all", click the row — exist because a barcode is
   * sometimes missing, torn, or the item is fabric sold by the metre.
   * ------------------------------------------------------------------ */
  const scanRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState('');
  const [lastHit, setLastHit] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);

  /** Clamp to what is actually returnable — never let the field exceed it. */
  function setQuantity(row: ReturnableLine, next: number): void {
    const max = Number(row.returnable_quantity);
    const clamped = Math.max(0, Math.min(next, max));
    setQty((p) => ({
      ...p,
      [row.sale_line_id]: clamped === 0 ? '' : String(Number(clamped.toFixed(3))),
    }));
  }

  const bump = (row: ReturnableLine, delta: number): void =>
    setQuantity(row, Number(qty[row.sale_line_id] ?? 0) + delta);

  /** Click the row: all of it, or none if it is already all. */
  function toggleRow(row: ReturnableLine): void {
    const max = Number(row.returnable_quantity);
    const now = Number(qty[row.sale_line_id] ?? 0);
    setQuantity(row, now >= max ? 0 : max);
  }

  function returnEverything(): void {
    const all: Record<string, string> = {};
    for (const r of rows) {
      const max = Number(r.returnable_quantity);
      if (max > 0) all[r.sale_line_id] = String(Number(max.toFixed(3)));
    }
    setQty(all);
  }

  /**
   * Resolve a scanned or typed code to one line and add a unit.
   *
   * Matching is deliberately ordered: an EXACT sku wins outright, because a
   * scanner is precise and a fuzzy name match must never beat it. Only then
   * does it fall back to a contains-search on the product name, for the case
   * where someone types "kurta" by hand.
   */
  function applyScan(raw: string): void {
    const q = raw.trim().toLowerCase();
    if (!q) return;
    setScanMiss(null);

    const exact = rows.find((r) => r.sku.toLowerCase() === q);
    const candidates = exact
      ? [exact]
      : rows.filter(
          (r) =>
            r.product_name.toLowerCase().includes(q) ||
            r.variant_name.toLowerCase().includes(q) ||
            r.sku.toLowerCase().includes(q),
        );

    const usable = candidates.filter((r) => Number(r.returnable_quantity) > 0);
    if (usable.length === 0) {
      setScanMiss(
        candidates.length > 0
          ? 'That item is on this bill but has already been fully returned.'
          : 'No line on this bill matches that code.',
      );
      setScan('');
      return;
    }
    if (usable.length > 1) {
      setScanMiss(`${usable.length} lines match — type more of the code or use the steppers.`);
      return;
    }

    const row = usable[0];
    bump(row, 1);
    setLastHit(row.sale_line_id);
    setScan('');
  }

  // The scan box owns focus on arrival: the first thing that happens is an
  // item being scanned, so nothing should have to be clicked first.
  useEffect(() => {
    if (rows.length > 0) scanRef.current?.focus();
  }, [rows.length]);

  // Clear the "just added" highlight so a second scan of the same line still
  // reads as a new event.
  useEffect(() => {
    if (!lastHit) return;
    const t = setTimeout(() => setLastHit(null), 1200);
    return () => clearTimeout(t);
  }, [lastHit]);
  const nothingLeft = rows.length > 0 && rows.every((r) => Number(r.returnable_quantity) <= 0);

  const save = useMutation({
    mutationFn: () =>
      createSaleReturn(id!, {
        lines: chosen.map((r) => ({
          sale_line_id: r.sale_line_id,
          quantity: Number(qty[r.sale_line_id]).toFixed(3),
        })),
        refunds:
          Number(refundAmount) > 0
            ? [{ method: refundMethod, amount: Number(refundAmount).toFixed(2) }]
            : [],
        reason: reason.trim(),
        notes: notes.trim() || null,
      }),
    onSuccess: (credit) => navigate(`/sales/${credit.id}/invoice`),
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record the return.'),
  });

  function submit(): void {
    setError(null);
    if (chosen.length === 0) {
      setError('Enter how many units are coming back.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required — it appears on the credit note and the audit log.');
      return;
    }
    // The server enforces this too; catching it here saves a round trip and
    // explains it against the specific line.
    const over = chosen.find(
      (r) => Number(qty[r.sale_line_id]) > Number(r.returnable_quantity),
    );
    if (over) {
      setError(
        `Only ${Number(over.returnable_quantity)} of ${over.product_name} can still be returned.`,
      );
      return;
    }
    save.mutate();
  }

  const sale = saleQuery.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Return items"
        description={
          sale
            ? `Against ${sale.number}. Stock goes back and a credit note is issued.`
            : 'Choose what is coming back.'
        }
        actions={
          <Button
            variant="ghost"
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate(`/sales/${id}/invoice`)}
          >
            Back to bill
          </Button>
        }
      />

      {linesQuery.isLoading && (
        <div className="text-sm text-slate-400">Loading the bill…</div>
      )}

      {/*
        A FAILED LOAD MUST SAY SO.

        The first version rendered the item table only when rows existed, so a
        404 from the server looked identical to a bill with nothing on it: an
        empty page reading "0 lines" and a button that did nothing. Silence is
        the worst possible response to a broken request — the cashier cannot
        tell a bug from an empty result.
      */}
      {linesQuery.isError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b className="font-semibold">Could not load this bill's items.</b>{' '}
            {linesQuery.error instanceof ApiError
              ? linesQuery.error.message
              : 'The server did not respond as expected.'}
            {linesQuery.error instanceof ApiError &&
              linesQuery.error.status === 404 && (
                <>
                  {' '}
                  This server does not support returns yet — the feature is
                  built but has not been deployed to it.
                </>
              )}
          </span>
        </div>
      )}

      {!linesQuery.isLoading && !linesQuery.isError && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-slate-400">
          This bill has no lines to return.
        </div>
      )}

      {nothingLeft && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Everything on this bill has already been returned.
        </div>
      )}

      {rows.length > 0 && (
        <GlassCard className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border-2 border-brand-600 bg-brand-600/10 px-3">
              <ScanBarcode className="h-4 w-4 shrink-0 text-brand-400" />
              <input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    // Read the LIVE value — a scanner fires the whole string
                    // plus Enter faster than React flushes the controlled input.
                    applyScan(e.currentTarget.value || scan);
                  }
                }}
                placeholder="Scan the item coming back, or type a SKU…"
                autoComplete="off"
                className="h-10 flex-1 bg-transparent font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={returnEverything}>
              Return everything
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setQty({})}>
              Clear
            </Button>
          </div>

          {scanMiss && (
            <div className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
              {scanMiss}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Already back</th>
                  <th className="px-3 py-2 text-right font-medium">Returnable</th>
                  <th className="px-3 py-2 text-right font-medium">Returning</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ReturnRow
                    key={r.sale_line_id}
                    row={r}
                    value={qty[r.sale_line_id] ?? ''}
                    justAdded={lastHit === r.sale_line_id}
                    onSet={(n) => setQuantity(r, n)}
                    onBump={(d) => bump(r, d)}
                    onToggle={() => toggleRow(r)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <GlassCard className="min-w-0 space-y-3 p-4">
          <Input
            label="Reason"
            placeholder="Wrong size, damaged, customer changed mind…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Textarea
            label="Notes"
            rows={2}
            placeholder="Optional — printed on the credit note"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </GlassCard>

        <GlassCard className="min-w-0 space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
            <span className="text-xs font-medium text-slate-400">Credit value</span>
            <span className="money text-total font-semibold leading-none text-white">
              <span className="text-xl text-slate-500">₹</span>
              {estimate.toFixed(2)}
            </span>
          </div>

          <Select
            label="Refund by"
            options={REFUND_METHODS}
            value={refundMethod}
            onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
          />
          <Input
            label="Refund now"
            type="number"
            step="0.01"
            min="0"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            hint="Leave at 0 to hold the credit on the customer's account instead."
          />

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            loading={save.isPending}
            disabled={
              save.isPending ||
              chosen.length === 0 ||
              nothingLeft ||
              linesQuery.isError ||
              linesQuery.isLoading
            }
            leadingIcon={<RotateCcw className="h-4 w-4" />}
            onClick={submit}
          >
            Record return
          </Button>
          {/* Say WHY the button is unavailable. A disabled control with no
              explanation is indistinguishable from a broken one. */}
          <p className="text-center text-xs text-slate-500">
            {linesQuery.isError
              ? 'Unavailable until the bill loads.'
              : chosen.length === 0
                ? 'Enter a quantity against at least one line above.'
                : `Puts ${chosen.length} ${chosen.length === 1 ? 'line' : 'lines'} back into stock and issues a credit note.`}
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

function ReturnRow({
  row, value, justAdded, onSet, onBump, onToggle,
}: {
  row: ReturnableLine;
  value: string;
  justAdded: boolean;
  onSet: (n: number) => void;
  onBump: (delta: number) => void;
  onToggle: () => void;
}): JSX.Element {
  const returnable = Number(row.returnable_quantity);
  const spent = returnable <= 0;
  const entered = Number(value || 0);

  return (
    <tr
      className={cn(
        'border-b border-border/50 last:border-b-0 transition-colors',
        spent && 'opacity-50',
        justAdded && 'bg-brand-600/15',
        entered > 0 && !justAdded && 'bg-surface-muted',
      )}
    >
      {/* Clicking the item toggles the whole line in or out. Most returns are
          "all of this one", and that should not cost any typing. */}
      <td
        className={cn('px-3 py-2', !spent && 'cursor-pointer')}
        onClick={() => !spent && onToggle()}
      >
        <div className="font-medium text-white">{row.product_name}</div>
        <div className="text-xs text-slate-500">
          {row.variant_name} · <span className="font-mono">{row.sku}</span>
        </div>
      </td>
      <td className="money px-3 py-2 text-right text-slate-300">
        ₹{Number(row.unit_price).toFixed(2)}
      </td>
      <td className="money px-3 py-2 text-right text-slate-400">
        {Number(row.sold_quantity)}
      </td>
      <td className="money px-3 py-2 text-right text-slate-400">
        {Number(row.returned_quantity) || '—'}
      </td>
      <td className="money px-3 py-2 text-right font-medium text-white">{returnable}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            disabled={spent || entered <= 0}
            onClick={() => onBump(-1)}
            aria-label="One fewer"
            className="grid h-7 w-7 place-items-center rounded-md border border-border-strong text-slate-300 hover:bg-surface-muted disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {/* Still typeable: fabric comes back as 2.5 metres, which no
              stepper should have to click to. */}
          <input
            type="number"
            min="0"
            max={returnable}
            step="0.001"
            disabled={spent}
            value={value}
            onChange={(e) => onSet(Number(e.target.value))}
            placeholder="0"
            className="money w-16 rounded-md border border-border-strong bg-surface-muted px-2 py-1 text-center text-sm text-slate-100 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
          />
          <button
            type="button"
            disabled={spent || entered >= returnable}
            onClick={() => onBump(1)}
            aria-label="One more"
            className="grid h-7 w-7 place-items-center rounded-md border border-border-strong text-slate-300 hover:bg-surface-muted disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
