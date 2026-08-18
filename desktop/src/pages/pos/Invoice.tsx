import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { getSale, PAYMENT_LABEL } from '@/lib/sales-api';
import { listStores } from '@/lib/stores-api';
import { listCustomers } from '@/lib/customers-api';
import { listUsers } from '@/lib/users-api';

/**
 * Printable invoice view.
 *
 * On screen it renders a preview inside the app shell; on print (via the
 * Print button or Ctrl+P) a scoped stylesheet hides everything except the
 * .invoice-sheet block, so the OS printer dialog gets a clean A5-ish page.
 *
 * GST split rule (India):
 *   - If customer state matches store state (or customer is walk-in), tax
 *     splits equally into CGST + SGST.
 *   - Otherwise, tax shows as IGST.
 */
export function Invoice(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const saleQuery = useQuery({
    queryKey: ['sale', id],
    queryFn: () => getSale(id!),
    enabled: !!id,
  });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: () => listCustomers(1, 500) });
  const staffQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const sale = saleQuery.data;
  const store = sale ? storesQuery.data?.items.find((s) => s.id === sale.store_id) : undefined;
  const customer = sale?.customer_id
    ? customersQuery.data?.items.find((c) => c.id === sale.customer_id)
    : undefined;
  const salesperson = sale?.salesperson_user_id
    ? staffQuery.data?.items.find((u) => u.id === sale.salesperson_user_id)
    : undefined;

  const isIgst = Boolean(
    store && customer && customer.state && store.state && customer.state.trim().toLowerCase() !== store.state.trim().toLowerCase(),
  );
  const cgstAmount = isIgst ? 0 : (Number(sale?.tax_total ?? '0') / 2);
  const sgstAmount = cgstAmount;
  const igstAmount = isIgst ? Number(sale?.tax_total ?? '0') : 0;

  // Auto-focus so Ctrl+P works right away.
  useEffect(() => {
    if (sale) window.scrollTo(0, 0);
  }, [sale]);

  return (
    <div className="space-y-6">
      <div className="no-print">
        <div className="flex items-center justify-between">
          <Button variant="ghost" leadingIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/pos')}>
            Back to POS
          </Button>
          <div className="flex items-center gap-2">
            {sale && Number(sale.balance_due) > 0 && (
              <Button
                variant="secondary"
                onClick={() => navigate('/billing/outstanding')}
              >
                Collect balance · ₹{sale.balance_due}
              </Button>
            )}
            <Button leadingIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
      </div>

      {saleQuery.isLoading && (
        <div className="text-sm text-slate-400">Loading invoice…</div>
      )}
      {saleQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Failed to load invoice.
        </div>
      )}

      {sale && (
        <div className="invoice-sheet mx-auto max-w-2xl rounded-2xl border border-border bg-white p-8 text-slate-900 shadow-glass-lg">
          <header className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <div className="text-xl font-semibold">{store?.name ?? '—'}</div>
              <div className="text-xs text-slate-500">
                {store?.address_line1}
                {store?.city && <>, {store.city}</>}
                {store?.state && <>, {store.state}</>}
                {store?.postal_code && <> {store.postal_code}</>}
              </div>
              {store?.gstin && (
                <div className="mt-1 text-xs">
                  <span className="text-slate-500">GSTIN:</span>{' '}
                  <span className="font-mono">{store.gstin}</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-500">Tax Invoice</div>
              <div className="mt-1 font-mono text-sm">{sale.number}</div>
              {sale.completed_at && (
                <div className="mt-1 text-xs text-slate-500">
                  {new Date(sale.completed_at).toLocaleString()}
                </div>
              )}
              {salesperson && (
                <div className="mt-1 text-xs text-slate-500">
                  Served by{' '}
                  <span className="text-slate-700">
                    {salesperson.full_name}
                    {salesperson.staff_code ? ` · ${salesperson.staff_code}` : ''}
                  </span>
                </div>
              )}
              {sale.status === 'voided' && (
                <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                  VOIDED
                </div>
              )}
            </div>
          </header>

          {/* Bill-to */}
          <section className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="uppercase tracking-wider text-slate-500">Bill to</div>
              {customer ? (
                <>
                  <div className="mt-1 text-sm font-medium">{customer.name}</div>
                  {customer.company_name && (
                    <div className="text-slate-500">{customer.company_name}</div>
                  )}
                  {customer.phone && <div>{customer.phone}</div>}
                  {customer.gstin && (
                    <div className="mt-1">
                      <span className="text-slate-500">GSTIN:</span>{' '}
                      <span className="font-mono">{customer.gstin}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1 italic text-slate-500">Walk-in customer</div>
              )}
            </div>
          </section>

          {/* Lines */}
          <table className="mt-6 w-full text-xs">
            <thead>
              <tr className="border-y border-slate-300 text-left uppercase tracking-wider text-slate-500">
                <th className="py-2">#</th>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
                <th className="text-right">GST %</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l, idx) => (
                <tr key={l.id} className="border-b border-slate-200 align-top">
                  <td className="py-2 text-slate-500">{idx + 1}</td>
                  <td className="py-2">
                    <div className="font-medium">{l.product_name}</div>
                    <div className="text-[10px] text-slate-500">
                      {l.variant_name} · <span className="font-mono">{l.sku}</span>
                      {l.hsn_code && <> · HSN {l.hsn_code}</>}
                    </div>
                    {Number(l.discount_pct) > 0 && (
                      <div className="text-[10px] text-slate-500">Disc {l.discount_pct}%</div>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono">{l.quantity}</td>
                  <td className="py-2 text-right font-mono">₹{l.unit_price}</td>
                  <td className="py-2 text-right font-mono">{l.tax_rate}%</td>
                  <td className="py-2 text-right font-mono">₹{l.line_total}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <section className="mt-4 grid grid-cols-2 gap-6 text-xs">
            <div className="text-slate-500">
              {sale.notes && (
                <>
                  <div className="uppercase tracking-wider">Notes</div>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{sale.notes}</p>
                </>
              )}
            </div>
            <dl className="space-y-1">
              <Row label="Subtotal" value={`₹${sale.subtotal}`} />
              {Number(sale.discount_total) > 0 && (
                <Row label="Discount" value={`− ₹${sale.discount_total}`} />
              )}
              {isIgst ? (
                <Row label="IGST" value={`₹${igstAmount.toFixed(2)}`} />
              ) : (
                <>
                  <Row label="CGST" value={`₹${cgstAmount.toFixed(2)}`} />
                  <Row label="SGST" value={`₹${sgstAmount.toFixed(2)}`} />
                </>
              )}
              <div className="my-2 border-t border-slate-300" />
              <div className="flex items-baseline justify-between">
                <dt className="text-sm font-medium">Grand total</dt>
                <dd className="font-mono text-lg font-semibold">₹{sale.grand_total}</dd>
              </div>
            </dl>
          </section>

          {/* Payments */}
          <section className="mt-6 border-t border-slate-200 pt-4 text-xs">
            <div className="uppercase tracking-wider text-slate-500">Payments</div>
            {sale.payments.length > 0 ? (
              <ul className="mt-1">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-0.5">
                    <span>
                      {PAYMENT_LABEL[p.method]}
                      {p.reference && <span className="ml-2 text-slate-500">{p.reference}</span>}
                    </span>
                    <span className="font-mono">₹{p.amount}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 italic text-slate-500">Bill saved on credit — no payment yet.</div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-1">
              <span className="text-slate-500">Total paid</span>
              <span className="font-mono">₹{sale.paid_total}</span>
            </div>
            {Number(sale.change_due) > 0 && (
              <div className="mt-1 flex items-center justify-between font-medium">
                <span>Change due</span>
                <span className="font-mono">₹{sale.change_due}</span>
              </div>
            )}
            {Number(sale.balance_due) > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-md border border-amber-400 bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                <span>Balance due</span>
                <span className="font-mono">₹{sale.balance_due}</span>
              </div>
            )}
          </section>

          <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-[10px] text-slate-500">
            Thank you for shopping with us.
          </footer>
        </div>
      )}

      {/* Print stylesheet */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print, header.titlebar-drag, aside, .grid-overlay { display: none !important; }
          main { overflow: visible !important; }
          .invoice-sheet {
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
