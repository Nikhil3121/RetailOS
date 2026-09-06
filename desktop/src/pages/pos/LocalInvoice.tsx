/**
 * Offline invoice — rendered entirely from SQLite.
 *
 * The existing Invoice.tsx fetches the sale from FastAPI, which means no
 * network, no receipt. This page reads the durable local sale instead, so a
 * customer gets a printed bill during an outage.
 *
 * It deliberately mirrors Invoice.tsx's layout and print CSS so the two look
 * the same on paper. Printing goes through the thermal abstraction added in
 * Phase 9, which falls back to the browser dialog whenever a thermal printer
 * is unavailable or fails — so a shop with no printer is a supported setup,
 * not a broken one. No physical printer has been verified.
 *
 * NO financial rules live in this file. Every figure is read back from the
 * sale that was committed; nothing is recalculated, so the receipt cannot
 * disagree with what was stored.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CloudOff, Printer } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { getLocalSale, type LocalSaleRecord } from '@/lib/local-checkout';
import { printSaleReceipt } from '@/lib/print-service';

/** Paise to a rupee string for display. Storage stays integer. */
function money(paise: number): string {
  return (paise / 100).toFixed(2);
}

function taxPercent(bp: number): string {
  const pct = bp / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  credit: 'Credit',
  other: 'Other',
};

function Detail({
  label, value, mono,
}: {
  label: string; value: string | null; mono?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`text-xs text-slate-300 ${mono ? 'font-mono break-all' : ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

export function LocalInvoice(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [sale, setSale] = useState<LocalSaleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);

  /**
   * Print through the thermal abstraction, falling back to the browser.
   *
   * The sale is already committed, so a printer problem must never leave a
   * cashier without paper: if the thermal path is unavailable or fails, the
   * browser dialog opens instead and the reason is shown rather than swallowed.
   */
  async function printReceipt(): Promise<void> {
    if (!sale) return;
    const outcome = await printSaleReceipt(sale.id);
    setPrintNote(
      outcome.via === 'thermal'
        ? null
        : `Printed through the browser dialog. ${outcome.reason}`,
    );
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!id) {
        setError('No sale reference supplied.');
        setLoading(false);
        return;
      }
      const record = await getLocalSale(id);
      if (cancelled) return;
      if (!record) {
        setError('This bill was not found on this terminal.');
      } else {
        setSale(record);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-slate-400">Loading bill…</div>;
  }

  if (error || !sale) {
    return (
      <div className="space-y-4 p-8">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error ?? 'Bill not found.'}
        </div>
        <Button variant="ghost" onClick={() => navigate('/billing')}>
          Back to billing
        </Button>
      </div>
    );
  }

  const paidPaise = sale.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const balancePaise = sale.totalPaise - paidPaise;
  const grossPaise = sale.subtotalPaise + sale.taxPaise + sale.discountPaise;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Button
          variant="ghost"
          leadingIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate('/billing')}
        >
          Back to bill
        </Button>
        <Button
          leadingIcon={<Printer className="h-4 w-4" />}
          onClick={() => void printReceipt()}
        >
          Print bill
        </Button>
      </div>

      {/* Sync state is information, not an error — the bill is already valid. */}
      {sale.syncStatus !== 'SYNCED' && (
        <div className="no-print flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>
            Saved on this terminal and queued to sync. The final GST invoice
            number is assigned when it reaches the server.
          </span>
        </div>
      )}

      {/* Provenance. `no-print` on purpose: the customer's copy shows the
          bill, not the terminal's internal identifiers. This block exists so
          staff can trace a bill end to end without a database tool. */}
      <details className="no-print rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-sm">
        <summary className="cursor-pointer text-slate-300">Sale details &amp; sync</summary>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Detail label="Local reference" value={sale.localReference} mono />
          <Detail
            label="Server invoice"
            value={sale.invoiceNumber ?? 'Not yet assigned'}
            mono
          />
          <Detail label="Transaction id" value={sale.id} mono />
          <Detail label="Server sale id" value={sale.serverId ?? 'Not yet synced'} mono />
          <Detail label="Terminal" value={sale.terminalUuid ?? 'Unknown terminal'} mono />
          <Detail
            label="Day session"
            value={sale.serverDaySessionId ?? 'Not recorded'}
            mono
          />
          <Detail
            label="Occurred at"
            value={
              sale.occurredAt
                ? new Date(sale.occurredAt).toLocaleString('en-IN')
                : new Date(sale.createdAt).toLocaleString('en-IN')
            }
          />
          <Detail label="Sync status" value={sale.syncStatus} />
        </dl>
      </details>

      {printNote && (
        <div className="no-print rounded-xl border border-slate-500/30 bg-slate-500/10 px-4 py-2 text-sm text-slate-300">
          {printNote}
        </div>
      )}

      <GlassCard className="invoice-sheet">
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div>
            <div className="text-lg font-semibold text-white">TAX INVOICE</div>
            <div className="mt-1 text-xs text-slate-400">
              {new Date(sale.createdAt).toLocaleString('en-IN')}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-white">
              {sale.invoiceNumber ?? sale.localReference ?? sale.id.slice(0, 8)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">
              {sale.invoiceNumber ? 'Invoice no.' : 'Local reference'}
            </div>
            {/* The internal id is the permanent trace back to this row. */}
            <div className="mt-2 font-mono text-xs text-slate-600">
              {sale.id}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 pr-2 text-right">Rate</th>
                <th className="py-2 pr-2 text-right">Disc.</th>
                <th className="py-2 pr-2 text-right">GST</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="font-variant-numeric tabular-nums">
              {sale.items.map((item, idx) => (
                <tr key={item.id} className="border-b border-border/40">
                  <td className="py-2 pr-2 text-slate-500">{idx + 1}</td>
                  <td className="py-2 pr-2">
                    <div className="text-slate-100">{item.productName}</div>
                    {item.sku && (
                      <div className="font-mono text-xs text-slate-500">{item.sku}</div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">{item.quantity}</td>
                  <td className="py-2 pr-2 text-right">₹{money(item.unitPricePaise)}</td>
                  <td className="py-2 pr-2 text-right">
                    {item.discountPaise > 0 ? `₹${money(item.discountPaise)}` : '—'}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {taxPercent(item.taxRateBp)}%
                    <div className="text-xs text-slate-500">
                      ₹{money(item.taxPaise)}
                    </div>
                  </td>
                  <td className="py-2 text-right text-slate-100">
                    ₹{money(item.lineTotalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-2 border-t border-border pt-4 text-sm tabular-nums">
          <Row label="Gross" value={money(grossPaise)} />
          {sale.discountPaise > 0 && (
            <Row label="Discount" value={`− ${money(sale.discountPaise)}`} />
          )}
          <Row label="Taxable value" value={money(sale.subtotalPaise)} />
          <Row label="GST" value={money(sale.taxPaise)} />
          {/* Whole-bill adjustments, each shown. A customer given ₹100 off
              looks for the ₹100 on the bill; folding it silently into the
              total is what makes them ask whether it was applied at all. */}
          {sale.billDiscountPaise > 0 && (
            <Row
              label={
                sale.couponCode
                  ? `Bill discount (${sale.couponCode})`
                  : sale.billDiscountReason
                    ? `Bill discount (${sale.billDiscountReason})`
                    : 'Bill discount'
              }
              value={`− ${money(sale.billDiscountPaise)}`}
            />
          )}
          {/* Points, not rupees — their value is already inside the bill
              discount above, and a second figure would read as more money off. */}
          {sale.redeemPoints > 0 && (
            <Row label="Points redeemed" value={String(sale.redeemPoints)} />
          )}
          {sale.roundOffPaise !== 0 && (
            <Row
              label="Round off"
              value={`${sale.roundOffPaise > 0 ? '+' : '−'} ${money(Math.abs(sale.roundOffPaise))}`}
            />
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-white">
            <span>Total</span>
            <span>₹{money(sale.totalPaise)}</span>
          </div>
          <Row label="Paid" value={money(paidPaise)} />
          {balancePaise > 0 && (
            <div className="flex justify-between text-amber-300">
              <span>Balance due</span>
              <span>₹{money(balancePaise)}</span>
            </div>
          )}
          {balancePaise < 0 && (
            <Row label="Change" value={money(Math.abs(balancePaise))} />
          )}
        </div>

        <div className="mt-4 border-t border-border pt-3 text-xs text-slate-400">
          <span className="uppercase tracking-wider text-slate-500">Payment: </span>
          {sale.payments.length > 0
            ? sale.payments
                .map((p) => `${PAYMENT_LABEL[p.method] ?? p.method} ₹${money(p.amountPaise)}`)
                .join(' · ')
            : 'Unpaid (credit)'}
        </div>

        {sale.notes && (
          <div className="mt-2 text-xs text-slate-400">
            <span className="uppercase tracking-wider text-slate-500">Notes: </span>
            {sale.notes}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span>₹{value.startsWith('−') ? value.slice(2) : value}</span>
    </div>
  );
}
