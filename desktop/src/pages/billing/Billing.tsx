import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  CloudOff,
  CreditCard,
  DoorOpen,
  ExternalLink,
  Minus,
  Plus,
  RefreshCw,
  ReceiptText,
  ScanBarcode,
  Smartphone,
  Trash2,
  Wallet,
  Wifi,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { getProduct, listProducts } from '@/lib/catalog-api';
import { listCustomers } from '@/lib/customers-api';
import { currentSession } from '@/lib/day-sessions-api';
import {
  createSale,
  type PaymentMethod,
  type SaleCreate,
  type SalePaymentInput,
} from '@/lib/sales-api';
import { listStores } from '@/lib/stores-api';
import { findUserByStaffCode, listUsers } from '@/lib/users-api';
import { cn } from '@/lib/cn';
import {
  enqueueBill,
  installAutoSync,
  newClientUuid,
  subscribeQueue,
  syncQueue,
  type QueuedBill,
} from '@/lib/offline-bills';
import { useAuthStore } from '@/stores/auth-store';
import { useHotkey } from '@/lib/hotkeys';
import { HeldBillsPanel, type HeldBillSnapshot } from './HeldBillsPanel';

const LAST_STORE_KEY = 'retailos.billing.last_store_id';
// Persisted queue of bills the operator has parked to serve another customer.
// Kept in localStorage (offline-first) — no backend involvement in this phase.
const HELD_BILLS_KEY = 'retailos.held-bills.v1';

interface BillLine {
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  quantity: number;
  discount_pct: number;
}

interface PickerVariant {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
}

interface Totals {
  gross: number;
  discount: number;
  subtotal: number;
  tax: number;
  grand: number;
}

const METHODS: {
  id: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'other', label: 'Other', icon: Wallet },
];

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeTotals(lines: BillLine[]): Totals {
  // Tax-INCLUSIVE pricing. Backend does the same math (services/sale.py):
  //   line_total = price × qty − discount     ← what customer pays
  //   subtotal   = line_total / (1 + tax%)    ← pre-tax base (derived)
  //   tax        = line_total − subtotal      ← embedded tax
  // So the "Grand total" the operator sees at the counter equals the sum of
  // (MRP × qty − discount) exactly — matches the tag price.
  let gross = 0;
  let discount = 0;
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const price = Number(l.unit_price) || 0;
    const g = price * l.quantity;
    const d = g * (l.discount_pct / 100);
    const lineTotal = g - d;
    const rate = Number(l.tax_rate) || 0;
    const divisor = 1 + rate / 100;
    const net = divisor !== 0 ? lineTotal / divisor : lineTotal;
    const t = lineTotal - net;
    gross += g;
    discount += d;
    subtotal += net;
    tax += t;
  }
  return {
    gross: round(gross),
    discount: round(discount),
    subtotal: round(subtotal),
    tax: round(tax),
    grand: round(subtotal + tax),
  };
}

/**
 * The counter-side billing page — pick products, pick a customer, enter
 * how much the customer actually paid (can be less than the total, or zero),
 * and generate a printable bill. Anything short is recorded as `balance_due`
 * and shows up under Billing → Outstanding for later collection.
 */
export function Billing(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // -----------------------------------------------------------------------
  // Store + session
  // -----------------------------------------------------------------------
  const [storeId, setStoreId] = useState<string>(
    () => localStorage.getItem(LAST_STORE_KEY) ?? user?.store_id ?? '',
  );
  useEffect(() => {
    if (storeId) localStorage.setItem(LAST_STORE_KEY, storeId);
  }, [storeId]);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => listCustomers(1, 500),
  });
  const staffQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(1, 500),
  });
  const activeStaff = (staffQuery.data?.items ?? []).filter(
    (u) => u.is_active,
  );
  // Always refetch when Billing mounts (or the store changes) so a session
  // just opened from the Day Session screen doesn't leave a stale "no session"
  // banner behind. Cache-invalidation from that screen fires the refetch too,
  // but this guarantees freshness even if the user navigates in the middle
  // of an in-flight mutation.
  const sessionQuery = useQuery({
    queryKey: ['day-session', 'current', storeId],
    queryFn: () => currentSession(storeId),
    enabled: !!storeId,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const sessionOpen = sessionQuery.data && sessionQuery.data.status === 'open';
  // `isLoading` is only true on the very first fetch; after that a refetch
  // sets `isFetching`. If we only watch isLoading, an in-flight refresh
  // shows the STALE "No open session" banner instead of a loader — which
  // is exactly the "banner still appears after opening" symptom.
  const sessionLoading = sessionQuery.isLoading || sessionQuery.isFetching;

  // -----------------------------------------------------------------------
  // Bill state
  // -----------------------------------------------------------------------
  const [lines, setLines] = useState<BillLine[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [salespersonId, setSalespersonId] = useState<string>('');
  const [staffCodeBuffer, setStaffCodeBuffer] = useState('');
  const [staffLookupError, setStaffLookupError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // Short-lived on-screen confirmation used by F3 Hold Bill. Auto-clears in
  // an effect below so we don't need a full toast system for one message.
  const [flash, setFlash] = useState<{ kind: 'info' | 'success'; text: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Held-bills UI — a pill in the header + a slide-in panel opened by
  // Shift+F3 (F3 alone parks the current cart). We keep a small mirror
  // count in state so the pill updates the instant a bill is held or
  // resumed, without waiting for the panel to open.
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldCount, setHeldCount] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(HELD_BILLS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  });
  // Refresh count when the panel closes (in case rows were discarded there)
  // and on the cross-tab `storage` event.
  useEffect(() => {
    function refresh(): void {
      try {
        const raw = window.localStorage.getItem(HELD_BILLS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setHeldCount(Array.isArray(parsed) ? parsed.length : 0);
      } catch {
        setHeldCount(0);
      }
    }
    refresh();
    function onStorage(e: StorageEvent): void {
      if (e.key === HELD_BILLS_KEY) refresh();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [heldOpen, flash]);

  // -----------------------------------------------------------------------
  // Offline queue — bills stashed in localStorage when the network is down.
  //  · `online` tracks navigator.onLine + browser events.
  //  · `queued` mirrors the localStorage queue for live badge updates.
  //  · `installAutoSync` fires a drain whenever the network comes back.
  // -----------------------------------------------------------------------
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [queued, setQueued] = useState<QueuedBill[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = subscribeQueue(setQueued);
    const uninstall = installAutoSync();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      unsub();
      uninstall();
    };
  }, []);

  async function syncNow(): Promise<void> {
    setSyncing(true);
    try {
      const res = await syncQueue();
      if (res.succeeded > 0) {
        qc.invalidateQueries({ queryKey: ['sales'] });
        qc.invalidateQueries({ queryKey: ['billing-outstanding'] });
        qc.invalidateQueries({ queryKey: ['billing-summary'] });
        qc.invalidateQueries({ queryKey: ['inventory-levels'] });
      }
    } finally {
      setSyncing(false);
    }
  }

  async function onStaffCodeKey(
    e: React.KeyboardEvent<HTMLInputElement>,
  ): Promise<void> {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = staffCodeBuffer.trim();
    if (!code) return;
    setStaffLookupError(null);
    // First try the local list — no network round-trip when the staff exists.
    const local = activeStaff.find(
      (u) => (u.staff_code ?? '').toUpperCase() === code.toUpperCase(),
    );
    if (local) {
      setSalespersonId(local.id);
      setStaffCodeBuffer('');
      return;
    }
    try {
      const found = await findUserByStaffCode(code);
      setSalespersonId(found.id);
      setStaffCodeBuffer('');
    } catch (err) {
      setStaffLookupError(
        err instanceof ApiError ? err.message : `No staff with code "${code}".`,
      );
    }
  }

  const salespersonName = salespersonId
    ? activeStaff.find((u) => u.id === salespersonId)?.full_name
    : undefined;

  const totals = useMemo(() => computeTotals(lines), [lines]);

  // Payment
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');

  // Whenever grand total changes, prefill "amount paid" with the full total,
  // so the common case (fully paid) is a one-click Save.
  useEffect(() => {
    setAmountPaid(totals.grand > 0 ? totals.grand.toFixed(2) : '');
  }, [totals.grand]);

  const paidNum = Number(amountPaid) || 0;
  const balanceDue = Math.max(round(totals.grand - paidNum), 0);
  const change = Math.max(round(paidNum - totals.grand), 0);
  const isDue = balanceDue > 0;

  // -----------------------------------------------------------------------
  // Product picker
  // -----------------------------------------------------------------------
  // Server-side search: instead of pre-loading 200 products and filtering
  // client-side (which quietly hid every SKU outside that window), the
  // picker now debounces the input by 250ms and asks the backend to
  // search across ALL 9k+ products. Matches on name / HSN / SKU / barcode
  // — see ProductService.list() for the OR/EXISTS clause.
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  // First page = "recently added". Any subsequent query hits the server
  // with the search text; 30 rows is enough to fit the picker dropdown
  // without a scrollbar.
  const summariesQuery = useQuery({
    queryKey: ['products', 'billing', debouncedQ],
    queryFn: () =>
      listProducts({
        page_size: 30,
        is_active: true,
        search: debouncedQ || undefined,
      }),
    placeholderData: (prev) => prev, // keep old rows visible while new ones fetch
  });

  // Fan out getProduct() per matched summary to pull variants. Limited to
  // 30 products max per query so the network cost stays bounded even when
  // the search is broad (e.g. "COTTON" returning 387 rows — we cap at 30).
  const variantsQuery = useQuery({
    queryKey: ['variants', 'billing', debouncedQ, summariesQuery.data?.items.map((s) => s.id)],
    enabled: !!summariesQuery.data,
    queryFn: async (): Promise<PickerVariant[]> => {
      const summaries = summariesQuery.data?.items ?? [];
      // `allSettled` so a single 404/500 doesn't blank the whole picker.
      const results = await Promise.allSettled(
        summaries.map((s) => getProduct(s.id)),
      );
      const out: PickerVariant[] = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const full = r.value;
        for (const v of full.variants) {
          if (!v.is_active) continue;
          out.push({
            variant_id: v.id,
            sku: v.sku,
            barcode: v.barcode,
            product_name: full.name,
            variant_name: v.name,
            unit_price: v.selling_price,
            tax_rate: full.tax_rate,
          });
        }
      }
      return out;
    },
    placeholderData: (prev) => prev,
  });

  const variants = variantsQuery.data ?? [];

  // The server already matched on the query; do a last-mile client filter
  // so an exact SKU/barcode scan wins even when the product has many
  // variants (e.g. same SKU across sizes).
  const filtered = useMemo(() => {
    const query = debouncedQ.toLowerCase();
    if (!query) return variants.slice(0, 30);
    // If any variant matches the query exactly on SKU/barcode, show only
    // those (scanner precision). Otherwise fall back to fuzzy contains.
    const exact = variants.filter(
      (v) => v.sku.toLowerCase() === query || (v.barcode ?? '').toLowerCase() === query,
    );
    if (exact.length > 0) return exact;
    return variants
      .filter((v) => {
        const hay = `${v.product_name} ${v.variant_name} ${v.sku} ${v.barcode ?? ''}`.toLowerCase();
        return hay.includes(query);
      })
      .slice(0, 30);
  }, [debouncedQ, variants]);

  useEffect(() => setActiveIdx(0), [debouncedQ]);

  // Scanner UX: track focus so the "Scanner ready" chip goes green, and
  // remember the last item added so we can flash confirmation in the picker.
  const [scannerFocused, setScannerFocused] = useState(false);
  const [lastAddedSku, setLastAddedSku] = useState<string | null>(null);

  function addVariant(v: PickerVariant): void {
    setLines((ls) => {
      const existing = ls.find((l) => l.variant_id === v.variant_id);
      if (existing) {
        return ls.map((l) =>
          l.variant_id === v.variant_id
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      return [
        ...ls,
        {
          variant_id: v.variant_id,
          sku: v.sku,
          product_name: v.product_name,
          variant_name: v.variant_name,
          unit_price: v.unit_price,
          tax_rate: v.tax_rate,
          quantity: 1,
          discount_pct: 0,
        },
      ];
    });
    setQ('');
    setLastAddedSku(v.sku);
    // Refocus so the very next barcode scan lands immediately.
    setTimeout(() => searchRef.current?.focus(), 0);
    // Clear the "just added" flash after a moment.
    setTimeout(() => setLastAddedSku((cur) => (cur === v.sku ? null : cur)), 1200);
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Barcode scanners fire the string + Enter at ~200 chars/sec, which is
      // faster than React can flush the controlled-input state. Read the
      // *live* DOM value here so we don't match against a stale `q`.
      const raw = (e.currentTarget.value ?? q).trim();
      if (!raw) return;
      const query = raw.toLowerCase();
      const exact = variants.find(
        (v) =>
          v.sku.toLowerCase() === query ||
          (v.barcode && v.barcode.toLowerCase() === query),
      );
      if (exact) {
        addVariant(exact);
        return;
      }
      // Fall back to a substring match against the whole scanned string,
      // then to the arrow-key highlighted row.
      const partial = variants.find((v) => {
        const hay = `${v.product_name} ${v.variant_name} ${v.sku} ${v.barcode ?? ''}`
          .toLowerCase();
        return hay.includes(query);
      });
      if (partial) {
        addVariant(partial);
        return;
      }
      if (filtered[activeIdx]) addVariant(filtered[activeIdx]);
    }
  }

  function updateLine(variantId: string, patch: Partial<BillLine>): void {
    setLines((ls) =>
      ls.map((l) => (l.variant_id === variantId ? { ...l, ...patch } : l)),
    );
  }
  function removeLine(variantId: string): void {
    setLines((ls) => ls.filter((l) => l.variant_id !== variantId));
  }

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: SaleCreate) => createSale(body),
    onSuccess: (sale) => {
      resetBillState();
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['billing-outstanding'] });
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      qc.invalidateQueries({ queryKey: ['inventory-levels'] });
      navigate(`/sales/${sale.id}/invoice`);
    },
    onError: (err, body) => {
      // A network-layer failure (typical when Mall Wi-Fi drops mid-transaction)
      // surfaces as a plain Error, not ApiError. In that case, queue the bill
      // and clear the form so the cashier can serve the next customer — the
      // idempotency key on the body guarantees no duplicate on replay.
      if (!(err instanceof ApiError)) {
        enqueueBill(body);
        resetBillState();
        return;
      }
      setError(err.message || 'Failed to save bill.');
    },
  });

  /**
   * Park the current cart as a "held" bill so the counter can serve a
   * different customer, then resume this one later. Snapshot lives in
   * localStorage — no backend round-trip, works offline.
   */
  function onHold(): void {
    if (lines.length === 0) {
      setFlash({ kind: 'info', text: 'Nothing to hold — cart is empty.' });
      return;
    }
    const snapshot = {
      id:
        typeof window.crypto?.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : `held-${Date.now()}`,
      held_at: new Date().toISOString(),
      store_id: storeId,
      customer_id: customerId || null,
      salesperson_id: salespersonId || null,
      notes,
      lines,
    };
    let prev: unknown[] = [];
    try {
      prev = JSON.parse(window.localStorage.getItem(HELD_BILLS_KEY) ?? '[]');
      if (!Array.isArray(prev)) prev = [];
    } catch {
      prev = [];
    }
    window.localStorage.setItem(HELD_BILLS_KEY, JSON.stringify([...prev, snapshot]));
    setLines([]);
    setNotes('');
    setFlash({ kind: 'success', text: `Bill held. ${prev.length + 1} bill(s) on hold.` });
  }

  /**
   * Restore a held snapshot back into the current cart. Called when the
   * operator picks a bill in HeldBillsPanel. The panel has already removed
   * the snapshot from storage, so there's nothing to clean up here.
   * Any lines currently on the cart are appended to the incoming lines —
   * we never silently discard operator work.
   */
  function onResumeHeld(snap: HeldBillSnapshot): void {
    const restoredLines = (snap.lines as BillLine[]) ?? [];
    setLines((current) => (current.length ? [...restoredLines, ...current] : restoredLines));
    if (snap.customer_id) setCustomerId(snap.customer_id);
    if (snap.salesperson_id) setSalespersonId(snap.salesperson_id);
    if (snap.notes) setNotes(snap.notes);
    setFlash({ kind: 'success', text: 'Bill resumed.' });
  }

  /**
   * F10 print handler. Behaviour matches shopkeeper expectation from Richie /
   * Marg: if the current cart has items, F10 is equivalent to "save + print"
   * (same path as F7 / the primary button, which already prints on success).
   * If the cart is empty, tell the operator instead of opening a print dialog
   * for the app chrome — that's confusing.
   */
  function onPrint(): void {
    if (lines.length === 0) {
      setFlash({ kind: 'info', text: 'Nothing to print — cart is empty.' });
      return;
    }
    onSave();
  }

  // Screen-local shortcuts — the "why" for each key:
  //   F7       = Save Bill (Marg convention: save + print in one action)
  //   F10      = Print — saves the current cart, receipt prints after success
  //   F3       = Hold Bill  (park cart, serve next customer, resume later)
  //   Shift+F3 = open the Held Bills panel to resume one
  useHotkey('F7', () => onSave());
  useHotkey('F10', () => onPrint());
  useHotkey('F3', (e) => {
    if (e.shiftKey) {
      setHeldOpen(true);
    } else {
      onHold();
    }
  });

  function onSave(): void {
    setError(null);
    if (!storeId) {
      setError('Select a store first.');
      return;
    }
    if (!sessionOpen) {
      setError('No open day session — open one from the Day Session screen.');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one product to the bill.');
      return;
    }
    if (paidNum < 0) {
      setError('Amount paid cannot be negative.');
      return;
    }
    if (isDue && !customerId) {
      setError(
        'A customer must be selected for a bill with an outstanding balance — you need someone to collect from later.',
      );
      return;
    }

    const payments: SalePaymentInput[] = [];
    if (paidNum > 0) {
      payments.push({
        method,
        amount: Math.min(paidNum, totals.grand + 100000).toFixed(2),
        reference:
          method === 'cash' ? null : reference.trim() || null,
      });
    }

    const body: SaleCreate = {
      store_id: storeId,
      customer_id: customerId || null,
      salesperson_user_id: salespersonId || null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        variant_id: l.variant_id,
        quantity: String(l.quantity),
        unit_price: l.unit_price,
        discount_pct: String(l.discount_pct),
      })),
      payments,
      // Stamp every attempt with the same idempotency key so an eventual
      // replay from the offline queue collapses to a single sale row.
      client_uuid: newClientUuid(),
    };

    // Offline gate — if the browser already knows we're offline, skip the
    // fetch and queue directly. The auto-sync installer will drain the queue
    // when the network is back.
    if (!navigator.onLine) {
      enqueueBill(body);
      resetBillState();
      return;
    }
    save.mutate(body);
  }

  function resetBillState(): void {
    setLines([]);
    setCustomerId('');
    setSalespersonId('');
    setStaffCodeBuffer('');
    setStaffLookupError(null);
    setNotes('');
    setReference('');
  }

  const busy = save.isPending;
  const customerName = customerId
    ? customersQuery.data?.items.find((c) => c.id === customerId)?.name
    : undefined;

  return (
    <div className="space-y-4">
      {/* F3 Hold Bill flash — fixed to the viewport so it doesn't shift layout. */}
      {flash && (
        <div
          className={cn(
            'pointer-events-none fixed bottom-6 right-6 z-50 rounded-xl px-4 py-2.5 text-sm font-medium shadow-glass-lg backdrop-blur-xl',
            flash.kind === 'success'
              ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30'
              : 'bg-white/10 text-slate-200 border border-border',
          )}
          role="status"
          aria-live="polite"
        >
          {flash.text}
        </div>
      )}
      <PageHeader
        title="Billing"
        description="Ring up a sale, print a bill, and save any unpaid balance as due — collect it later from Billing → Outstanding. Shortcuts: F2 new · F7 save · F10 print · F3 hold · Shift+F3 resume · F9 today's bills."
        actions={
          <div className="flex items-center gap-2">
            {/* Held-bills pill: shown whenever there's at least one parked
                bill so the operator can never forget about them. Click or
                press Shift+F3 to open the resume panel. */}
            {heldCount > 0 && (
              <button
                type="button"
                onClick={() => setHeldOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-400/70 hover:bg-amber-500/20"
                title="Resume a held bill (Shift+F3)"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Held: {heldCount}
              </button>
            )}
            <ConnectionChip
              online={online}
              queuedCount={queued.length}
              syncing={syncing}
              onSync={syncNow}
            />
          </div>
        }
      />
      <HeldBillsPanel
        storageKey={HELD_BILLS_KEY}
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        onResume={onResumeHeld}
        resolveCustomerName={(id) =>
          id ? customersQuery.data?.items.find((c) => c.id === id)?.name : undefined
        }
      />

      {/* Store + customer + session bar */}
      <GlassCard className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
          <Select
            label="Customer"
            placeholder="— Walk-in —"
            options={(customersQuery.data?.items ?? []).map((c) => ({
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`,
              value: c.id,
            }))}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            hint={
              isDue && !customerId
                ? 'Required for due bills'
                : undefined
            }
          />
          <div className="flex items-end">
            <SessionBanner
              hasStore={!!storeId}
              open={!!sessionOpen}
              loading={sessionLoading}
            />
          </div>
        </div>

        {/* Salesperson attribution row — the staff who gets commission +
            performance credit for this bill. Two ways to pick them:
             1. Type the STF-#### code into the quick-entry and press Enter
             2. Choose from the dropdown */}
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input
            label="Salesperson code"
            placeholder="Type STF-0001 · Enter"
            value={staffCodeBuffer}
            onChange={(e) => setStaffCodeBuffer(e.target.value)}
            onKeyDown={onStaffCodeKey}
            error={staffLookupError ?? undefined}
          />
          <Select
            label="Salesperson"
            placeholder="— No salesperson (cashier gets credit) —"
            options={activeStaff.map((u) => ({
              label: `${u.staff_code ? `${u.staff_code} · ` : ''}${u.full_name}`,
              value: u.id,
            }))}
            value={salespersonId}
            onChange={(e) => {
              setSalespersonId(e.target.value);
              setStaffLookupError(null);
            }}
          />
          <div className="flex items-end">
            {salespersonName ? (
              <div className="w-full rounded-xl border border-cobalt-500/30 bg-cobalt-500/10 px-3 py-2 text-xs text-cobalt-100">
                Commission + performance credit →{' '}
                <span className="font-semibold">{salespersonName}</span>
              </div>
            ) : (
              <div className="w-full rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
                No salesperson picked — the cashier at the register gets credit.
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Main split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        {/* Left — product picker + lines */}
        <div className="space-y-4">
          <GlassCard
            className={cn(
              'p-4 transition-colors',
              scannerFocused && 'border-cobalt-500/50 shadow-glow',
            )}
          >
            {/* Scanner header — a clear affordance so the operator knows this
                input IS the scanner target (not a passive search box). Icon +
                label + a live "Ready / Idle" chip that turns green on focus. */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
                    scannerFocused
                      ? 'border-cobalt-500/40 bg-cobalt-500/15 text-cobalt-100 shadow-glow'
                      : 'border-border bg-white/[0.03] text-slate-400',
                  )}
                >
                  <ScanBarcode className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-semibold uppercase tracking-wider text-white">
                    Scan barcode
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Or type SKU / product name and press Enter
                  </div>
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors',
                  scannerFocused
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-border bg-white/[0.02] text-slate-500',
                )}
              >
                <Zap className="h-3 w-3" />
                {scannerFocused ? 'Scanner ready' : 'Click to activate'}
              </span>
            </div>

            <input
              ref={searchRef}
              type="text"
              placeholder="Scan a barcode now, or type SKU / name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              onFocus={() => setScannerFocused(true)}
              onBlur={() => setScannerFocused(false)}
              autoComplete="off"
              autoFocus
              className={cn(
                'w-full rounded-xl border bg-white/[0.02] px-4 py-3 font-mono text-base text-slate-100 placeholder:text-slate-500',
                'transition-colors focus:outline-none',
                scannerFocused
                  ? 'border-cobalt-400 ring-2 ring-cobalt-400/40'
                  : 'border-border',
              )}
            />

            {/* Just-added flash so a scan visibly confirms even when the row
                scrolls out of view. */}
            {lastAddedSku && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Added <span className="font-mono">{lastAddedSku}</span> to bill
              </div>
            )}

            {/* Loading / error / empty states — used to be a single ambiguous
                "No active products". Now the operator can tell load failed
                from genuinely empty and can retry without a page reload. */}
            {summariesQuery.isLoading || variantsQuery.isLoading ? (
              <div className="mt-4 text-sm text-slate-400">Loading catalog…</div>
            ) : summariesQuery.isError || variantsQuery.isError ? (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <span>
                  Failed to load the catalog.{' '}
                  {(summariesQuery.error instanceof ApiError
                    ? summariesQuery.error.message
                    : null) ??
                    (variantsQuery.error instanceof ApiError
                      ? variantsQuery.error.message
                      : 'Check that the backend is running.')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={() => {
                    void summariesQuery.refetch();
                    void variantsQuery.refetch();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : filtered.length > 0 ? (
              <ul className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-border">
                {filtered.map((v, idx) => (
                  <li
                    key={v.variant_id}
                    onClick={() => addVariant(v)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between border-b border-border/60 px-4 py-2.5 last:border-b-0 hover:bg-white/[0.03]',
                      idx === activeIdx && 'bg-cobalt-500/10',
                      lastAddedSku === v.sku && 'bg-emerald-500/10',
                    )}
                  >
                    <div>
                      <div className="text-sm font-medium text-white">
                        {v.product_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {v.variant_name} · <span className="font-mono">{v.sku}</span>
                        {v.barcode && (
                          <>
                            {' · '}
                            <span className="font-mono">{v.barcode}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-white">₹{v.unit_price}</div>
                      <div className="text-xs text-slate-500">GST {v.tax_rate}%</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border px-4 py-6 text-center text-sm text-slate-400">
                <span>
                  {q
                    ? 'No product matches that search.'
                    : variants.length === 0
                      ? 'No active products in the catalog. Add one from Catalog → Products, or activate an existing product.'
                      : 'No product matches that filter.'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={() => {
                    void summariesQuery.refetch();
                    void variantsQuery.refetch();
                  }}
                >
                  Refresh catalog
                </Button>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-0">
            <div className="border-b border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Bill items ({lines.length})
            </div>

            {lines.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                No items yet. Scan or search a product above to start the bill.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr className="border-b border-border/60">
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Disc %</th>
                      <th className="px-3 py-2 text-right">GST %</th>
                      <th className="px-3 py-2 text-right">Line total</th>
                      <th className="px-3 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      // Tax-inclusive: the "total" column is just the
                      // post-discount extended price — GST is already
                      // embedded in unit_price and shown separately in
                      // the totals card below.
                      const price = Number(l.unit_price) || 0;
                      const gross = price * l.quantity;
                      const total = gross * (1 - l.discount_pct / 100);
                      return (
                        <tr
                          key={l.variant_id}
                          className="border-b border-border/40 align-middle last:border-b-0"
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-white">
                              {l.product_name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {l.variant_name} ·{' '}
                              <span className="font-mono">{l.sku}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <QtyStepper
                              value={l.quantity}
                              onChange={(n) =>
                                updateLine(l.variant_id, {
                                  quantity: Math.max(n, 0.001),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l.unit_price}
                              onChange={(e) =>
                                updateLine(l.variant_id, {
                                  unit_price: e.target.value,
                                })
                              }
                              className="w-24 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-cobalt-400 focus:outline-none focus:ring-1 focus:ring-cobalt-400/40"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={l.discount_pct}
                              onChange={(e) =>
                                updateLine(l.variant_id, {
                                  discount_pct: Math.max(
                                    Math.min(Number(e.target.value) || 0, 100),
                                    0,
                                  ),
                                })
                              }
                              className="w-16 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-cobalt-400 focus:outline-none focus:ring-1 focus:ring-cobalt-400/40"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                            {l.tax_rate}%
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-100">
                            ₹{total.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(l.variant_id)}
                              className="text-slate-500 hover:text-rose-300"
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </div>

        {/* Right — payment + save */}
        <GlassCard className="sticky top-4 h-fit p-4">
          <dl className="space-y-1 rounded-xl border border-border bg-white/[0.02] p-3 text-sm">
            <Row label="Subtotal" value={`₹${totals.subtotal.toFixed(2)}`} />
            {totals.discount > 0 && (
              <Row
                label="Discount"
                value={`− ₹${totals.discount.toFixed(2)}`}
                tone="dim"
              />
            )}
            <Row label="Tax (GST)" value={`₹${totals.tax.toFixed(2)}`} tone="dim" />
            <div className="my-1 border-t border-border/60" />
            <Row
              label="Grand total"
              value={`₹${totals.grand.toFixed(2)}`}
              strong
            />
          </dl>

          {/* Payment method */}
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Payment method
            </div>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                const active = m.id === method;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 rounded-xl border py-2 text-xs font-medium transition-colors',
                      active
                        ? 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-100 shadow-glow'
                        : 'border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount paid */}
          <div className="mt-4">
            <Input
              label="Amount received"
              type="number"
              step="0.01"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <QuickChip
                onClick={() => setAmountPaid(totals.grand.toFixed(2))}
                label="Full"
                accent="cobalt"
              />
              <QuickChip onClick={() => setAmountPaid('0')} label="All due" accent="amber" />
              {[100, 200, 500, 1000, 2000].map((v) => (
                <QuickChip
                  key={v}
                  onClick={() => setAmountPaid(v.toFixed(2))}
                  label={`₹${v}`}
                />
              ))}
            </div>
          </div>

          {method !== 'cash' && (
            <div className="mt-3">
              <Input
                label="Reference (optional)"
                placeholder="last 4 digits · UPI txn id"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          )}

          {/* Due / change summary */}
          <div
            className={cn(
              'mt-4 rounded-xl border px-3 py-2 text-sm',
              isDue
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                : change > 0
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                  : 'border-border bg-white/[0.02] text-slate-400',
            )}
          >
            {isDue ? (
              <div className="flex items-center justify-between">
                <span className="font-medium">Balance due</span>
                <span className="font-mono text-base font-semibold">
                  ₹{balanceDue.toFixed(2)}
                </span>
              </div>
            ) : change > 0 ? (
              <div className="flex items-center justify-between">
                <span className="font-medium">Change to return</span>
                <span className="font-mono text-base font-semibold">
                  ₹{change.toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span>Fully paid</span>
                <span className="font-mono">₹0.00</span>
              </div>
            )}
          </div>

          {isDue && customerName && (
            <p className="mt-2 text-xs text-slate-400">
              Will be recorded against{' '}
              <span className="text-slate-200">{customerName}</span>. Collect later
              from Billing → Outstanding.
            </p>
          )}
          {isDue && !customerName && (
            <p className="mt-2 text-xs text-amber-300">
              Pick a customer above — a due bill needs someone to collect from.
            </p>
          )}

          <div className="mt-3">
            <Textarea
              label="Notes"
              rows={2}
              placeholder="Optional — internal note printed on the bill"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="mt-4">
            <Button
              size="lg"
              className="w-full"
              loading={busy}
              disabled={busy || lines.length === 0}
              leadingIcon={<ReceiptText className="h-4 w-4" />}
              onClick={onSave}
            >
              {isDue ? 'Save bill (with due)' : 'Save & print bill'}
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SessionBanner({
  hasStore,
  open,
  loading,
}: {
  hasStore: boolean;
  open: boolean;
  loading: boolean;
}): JSX.Element {
  if (!hasStore) {
    return (
      <div className="w-full rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
        Select a store to begin.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="w-full rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
        Checking day session…
      </div>
    );
  }
  if (!open) {
    return (
      <a
        href="#/day-session"
        className="flex w-full items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/15"
      >
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          No open day session
        </span>
        <span className="flex items-center gap-1 font-medium">
          Open <ExternalLink className="h-3 w-3" />
        </span>
      </a>
    );
  }
  return (
    <div className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
      <DoorOpen className="h-4 w-4" />
      Day session is open — billing is live.
    </div>
  );
}

function QtyStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        step="1"
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-14 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-center font-mono text-xs text-slate-100 focus:border-cobalt-400 focus:outline-none focus:ring-1 focus:ring-cobalt-400/40"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function QuickChip({
  onClick,
  label,
  accent,
}: {
  onClick: () => void;
  label: string;
  accent?: 'cobalt' | 'amber';
}): JSX.Element {
  const cls =
    accent === 'cobalt'
      ? 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200 hover:bg-cobalt-500/20'
      : accent === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
        : 'border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-md border px-2.5 py-1 text-xs font-medium', cls)}
    >
      {label}
    </button>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'dim';
}): JSX.Element {
  const toneClass = tone === 'dim' ? 'text-slate-400' : 'text-slate-200';
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-medium text-slate-200' : 'text-slate-400'}>
        {label}
      </dt>
      <dd
        className={cn(
          'font-mono',
          toneClass,
          strong && 'text-base font-semibold text-white',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection + offline-queue chip
// ---------------------------------------------------------------------------

function ConnectionChip({
  online,
  queuedCount,
  syncing,
  onSync,
}: {
  online: boolean;
  queuedCount: number;
  syncing: boolean;
  onSync: () => void;
}): JSX.Element {
  if (queuedCount > 0) {
    return (
      <button
        type="button"
        onClick={onSync}
        disabled={syncing || !online}
        className={cn(
          'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
          online
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-100 cursor-not-allowed',
        )}
        title={
          online
            ? 'Bills queued locally — click to sync now.'
            : "Bills queued locally — they'll sync as soon as the network is back."
        }
      >
        {syncing ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : online ? (
          <RefreshCw className="h-3.5 w-3.5" />
        ) : (
          <CloudOff className="h-3.5 w-3.5" />
        )}
        {queuedCount} queued
        {online && !syncing && ' — sync'}
      </button>
    );
  }
  if (!online) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100">
        <CloudOff className="h-3.5 w-3.5" />
        Offline — new bills will queue
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100">
      <Wifi className="h-3.5 w-3.5" />
      Online
    </div>
  );
}
