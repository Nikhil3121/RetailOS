import { useCallback, useEffect, useState } from 'react';
import { Clock, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { listParked, unpark, type HeldBillItem } from '@/lib/held-bills-store';

/**
 * Held-bills panel — the resume-side of the F3 Hold Bill flow.
 *
 * Lists every cart parked for THIS BRANCH — from the server, so the other
 * till can see it, falling back to this machine when the network is down.
 * Rows say which, because a bill parked offline can only be resumed here and a
 * cashier should not walk to the other counter to find nothing.
 *
 * Deletion is idempotent: two tills racing for the same customer is normal,
 * and the one that loses should simply see the row disappear.
 *
 * Kept in the billing folder (not `components/ui`) because its shape is
 * tightly coupled to the BillLine model on the same page.
 */

export interface HeldBillSnapshot {
  id: string;
  held_at: string;
  store_id: string;
  customer_id: string | null;
  salesperson_id: string | null;
  notes: string;
  lines: unknown[]; // BillLine[] but this file stays cart-model-agnostic
}

interface HeldBillsPanelProps {
  /** Which branch's parked carts to show. Held bills are per branch. */
  storeId: string;
  open: boolean;
  onClose: () => void;
  onResume: (snapshot: HeldBillSnapshot) => void;
  /** Optional label lookup so we can show the customer's name, not just an id. */
  resolveCustomerName?: (customerId: string | null) => string | undefined;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function HeldBillsPanel({
  storeId,
  open,
  onClose,
  onResume,
  resolveCustomerName,
}: HeldBillsPanelProps): JSX.Element | null {
  const [items, setItems] = useState<HeldBillItem[]>([]);
  const [shared, setShared] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await listParked(storeId);
      setItems(res.items);
      setShared(res.shared);
    } finally {
      setLoading(false);
    }
  }, [open, storeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-read every 30s while the panel is open: the "3m ago" labels stay
  // honest, and a bill the OTHER till parked shows up without anyone
  // reopening the panel.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [open, refresh]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  async function discard(item: HeldBillItem): Promise<void> {
    // Optimistic: the row goes immediately so a busy counter is not waiting on
    // the network to see its own click take effect.
    setItems((prev) => prev.filter((s) => s.id !== item.id));
    await unpark(item);
  }

  async function clearAll(): Promise<void> {
    const all = items;
    setItems([]);
    await Promise.all(all.map((i) => unpark(i)));
  }

  async function handleResume(item: HeldBillItem): Promise<void> {
    // Removed first so a double-click cannot restore the cart twice.
    await discard(item);
    onResume(item);
    onClose();
  }

  return (
    // Backdrop — click anywhere outside the card to close.
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong mt-14 mr-6 flex max-h-[80vh] w-[420px] flex-col overflow-hidden"
        role="dialog"
        aria-label="Held bills"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-300" />
            <h2 className="text-sm font-semibold text-slate-100">
              Held bills
              <span className="ml-2 text-slate-400">({items.length})</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white"
            aria-label="Close held bills panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* "Nothing is parked" and "we could not ask" are different facts, and
            a cashier who reads the first when the second is true will re-ring
            a bill that is already waiting at the other counter. */}
        {!shared && !loading && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Offline — showing this till&apos;s parked bills only. Bills held at
            the other counter are not listed.
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-slate-300">
              {loading ? 'Loading held bills…' : 'No held bills.'}
            </p>
            <p className="text-xs text-slate-500">
              Press <kbd className="rounded bg-white/5 px-2 py-1 text-xs">F3</kbd>{' '}
              on the Billing screen to park the current cart.
            </p>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-auto">
              {items.map((s) => {
                const customer = resolveCustomerName?.(s.customer_id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-slate-100">
                        <span className="font-medium">
                          {customer ?? 'Walk-in customer'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {s.lines.length} item{s.lines.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>{relativeTime(s.held_at)}</span>
                        {/* A bill parked while offline can only be resumed at
                            THIS till, because no other till can see it. Said
                            on the row rather than letting a cashier walk to
                            the other counter and find nothing. */}
                        {s.source === 'this-till' && (
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                            this till only
                          </span>
                        )}
                        {s.notes ? (
                          <span className="ml-2 truncate italic text-slate-500">
                            · {s.notes}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleResume(s)}
                      >
                        Resume
                      </Button>
                      <button
                        type="button"
                        title="Discard this held bill"
                        onClick={() => void discard(s)}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-md text-slate-400',
                          'hover:bg-rose-500/10 hover:text-rose-300',
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <footer className="border-t border-border px-4 py-2 text-right">
              <Button size="sm" variant="ghost" onClick={() => void clearAll()}>
                Clear all
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
