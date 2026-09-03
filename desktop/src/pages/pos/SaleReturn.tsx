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

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, RotateCcw, TriangleAlert } from 'lucide-react';

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
          <div className="border-b border-border px-4 py-3 text-xs font-medium text-slate-400">
            What is coming back
          </div>
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
                    onChange={(v) => setQty((p) => ({ ...p, [r.sale_line_id]: v }))}
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
  row, value, onChange,
}: {
  row: ReturnableLine;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const returnable = Number(row.returnable_quantity);
  const spent = returnable <= 0;
  const entered = Number(value || 0);
  const over = entered > returnable;

  return (
    <tr className={cn('border-b border-border/50 last:border-b-0', spent && 'opacity-50')}>
      <td className="px-3 py-2">
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
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min="0"
          max={returnable}
          step="0.001"
          disabled={spent}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className={cn(
            'w-24 rounded-lg border bg-surface-muted px-2 py-1 text-right text-sm text-slate-100',
            'focus:outline-none focus:ring-2',
            over
              ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/25'
              : 'border-border-strong focus:border-brand-600 focus:ring-brand-600/25',
          )}
        />
      </td>
    </tr>
  );
}
