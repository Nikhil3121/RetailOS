import { useEffect, useMemo, useState } from 'react';
import { Clock, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Held-bills panel — the resume-side of the F3 Hold Bill flow.
 *
 * Reads snapshots the Billing screen wrote into localStorage under
 * `HELD_BILLS_KEY`, renders them in reverse-chronological order, and calls
 * `onResume` with a snapshot when the operator picks one. The panel owns
 * discard-a-single-row and clear-all buttons; deletion is idempotent so
 * concurrent tabs don't clobber each other.
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
  storageKey: string;
  open: boolean;
  onClose: () => void;
  onResume: (snapshot: HeldBillSnapshot) => void;
  /** Optional label lookup so we can show the customer's name, not just an id. */
  resolveCustomerName?: (customerId: string | null) => string | undefined;
}

function readSnapshots(storageKey: string): HeldBillSnapshot[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeldBillSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeSnapshots(storageKey: string, list: HeldBillSnapshot[]): void {
  window.localStorage.setItem(storageKey, JSON.stringify(list));
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
  storageKey,
  open,
  onClose,
  onResume,
  resolveCustomerName,
}: HeldBillsPanelProps): JSX.Element | null {
  const [tick, setTick] = useState(0); // rerender-only counter for re-reading storage
  const snapshots = useMemo(() => readSnapshots(storageKey), [storageKey, tick, open]);

  // Refresh the list every 30s so "3m ago" labels stay honest while the panel is open.
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [open]);

  // Cross-tab sync — if another tab pushes a new hold, reflect it here.
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key === storageKey) setTick((n) => n + 1);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

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

  function discard(id: string): void {
    const next = readSnapshots(storageKey).filter((s) => s.id !== id);
    writeSnapshots(storageKey, next);
    setTick((n) => n + 1);
  }

  function clearAll(): void {
    writeSnapshots(storageKey, []);
    setTick((n) => n + 1);
  }

  function handleResume(snapshot: HeldBillSnapshot): void {
    // Remove first so double-click can't restore + duplicate. Idempotent.
    discard(snapshot.id);
    onResume(snapshot);
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
              <span className="ml-2 text-slate-400">({snapshots.length})</span>
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

        {snapshots.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-slate-300">No held bills.</p>
            <p className="text-xs text-slate-500">
              Press <kbd className="rounded bg-white/5 px-2 py-1 text-xs">F3</kbd>{' '}
              on the Billing screen to park the current cart.
            </p>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-auto">
              {[...snapshots].reverse().map((s) => {
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
                      <div className="mt-1 text-xs text-slate-400">
                        {relativeTime(s.held_at)}
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
                        onClick={() => handleResume(s)}
                      >
                        Resume
                      </Button>
                      <button
                        type="button"
                        title="Discard this held bill"
                        onClick={() => discard(s.id)}
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
              <Button size="sm" variant="ghost" onClick={clearAll}>
                Clear all
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
