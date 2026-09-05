import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Award,
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
  Store,
  Trash2,
  Users,
  Wallet,
  Wifi,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { decideAdd, type AddSource } from '@/lib/cart-rules';
import { cashSuggestions, presentLine, summariseSavings } from '@/lib/cart-presentation';
import { commitLocalSale, isLocalCheckoutAvailable } from '@/lib/local-checkout';
import { useDeviceIdentity } from '@/hooks/useDeviceIdentity';
import { toPickerVariant } from '@/lib/local-catalog-adapter';
import { useLocalCatalog } from '@/hooks/useLocalCatalog';
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
import { snapshotStores } from '@/lib/store-snapshot';
import { LoyaltyChip } from '@/components/billing/LoyaltyChip';
import { resolvePrices, type ResolvedPrice } from '@/lib/price-lists-api';
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
  // Snapshotted onto the bill at sale time. A later catalog edit must not be
  // able to rewrite a receipt that has already been handed to a customer.
  mrp?: string | null;
  hsn_code?: string | null;
}

interface PickerVariant {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  mrp?: string | null;
  hsn_code?: string | null;
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

  // Local SQLite catalog. `ready` is true only when a catalog has actually
  // been synced — a NOT_INITIALIZED terminal keeps using the online path.
  const localCatalog = useLocalCatalog();

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

  // Cache the shop locally so the THERMAL receipt can print its name, address
  // and GSTIN with the network down. The main process cannot fetch this itself;
  // this screen is the last authenticated point before a bill is printed.
  const storeItems = storesQuery.data?.items;
  useEffect(() => {
    if (storeItems && storeItems.length > 0) void snapshotStores(storeItems);
  }, [storeItems]);

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
  const deviceIdentity = useDeviceIdentity();
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

  // Auto-select the store with an open day session.
  // Reason: if the operator opens a session for MS MALL 2, then comes to
  // Billing, the store selector previously defaulted to whatever was in
  // localStorage (often the other branch), which showed a confusing
  // "No open session" banner. Now we peek at every store's current
  // session and, if the CURRENT storeId has no open session but exactly
  // one OTHER store does, we silently switch to that store. Only fires
  // once per mount so the operator can still manually override.
  const allStores = storesQuery.data?.items ?? [];
  const openSessionProbes = useQueries({
    queries: allStores.map((s) => ({
      queryKey: ['day-session', 'current', s.id],
      queryFn: () => currentSession(s.id),
      staleTime: 0,
      refetchOnMount: 'always' as const,
    })),
  });
  const storeIdsWithOpenSession = allStores
    .map((s, i) => (openSessionProbes[i]?.data?.status === 'open' ? s.id : null))
    .filter((x): x is string => !!x);
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (autoSwitchedRef.current) return;
    // Wait until all probes have resolved so we don't switch prematurely.
    if (openSessionProbes.some((q) => q.isLoading)) return;
    // Current store already has an open session — nothing to do.
    if (storeIdsWithOpenSession.includes(storeId)) return;
    // Exactly one other store has an open session — pick it.
    if (storeIdsWithOpenSession.length === 1) {
      autoSwitchedRef.current = true;
      setStoreId(storeIdsWithOpenSession[0]);
    }
  }, [openSessionProbes, storeId, storeIdsWithOpenSession]);

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

  // Presentation only — the authoritative totals stay in computeTotals.
  const savings = useMemo(() => summariseSavings(lines), [lines]);

  // Presentation only — a units count for the bill header. Fabric sells by
  // the metre, so this is not always a whole number.
  const totalUnits = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity, 0),
    [lines],
  );

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
  const amountRef = useRef<HTMLInputElement>(null);

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
            mrp: v.mrp ?? null,
            hsn_code: full.hsn_code ?? null,
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

  /**
   * Whether the picker has an actual question to answer.
   *
   * `filtered` deliberately falls back to the first 30 catalog rows on an
   * empty query — that fallback still serves keyboard selection, but it is not
   * something to put on screen. The bill belongs in that space instead.
   */
  const showResults = q.trim().length > 0;

  // Scanner UX: track focus so the "Scanner ready" chip goes green, and
  // remember the last item added so we can flash confirmation in the picker.
  const [scannerFocused, setScannerFocused] = useState(false);
  const [lastAddedSku, setLastAddedSku] = useState<string | null>(null);

  /**
   * Add a variant to the cart.
   *
   * `source` decides what happens when the variant is already on the bill:
   * a repeated SCAN is refused (almost always an accidental double-trigger),
   * while a repeated manual pick still increments, which is how cashiers
   * build quantity from the picker today. See lib/cart-rules.ts.
   */
  function addVariant(v: PickerVariant, source: AddSource = 'manual'): void {
    const decision = decideAdd(lines, v.variant_id, source);

    if (decision.action === 'reject') {
      setFlash({ kind: 'info', text: decision.message });
      setQ('');
      // Refocus so the next scan still lands — a refused duplicate must not
      // leave the cashier having to click back into the field.
      setTimeout(() => searchRef.current?.focus(), 0);
      return;
    }

    setLines((ls) => {
      if (decision.action === 'increment') {
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
          mrp: v.mrp ?? null,
          hsn_code: v.hsn_code ?? null,
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

  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>): Promise<void> {
    if (e.key === 'Escape') {
      // Clears a mistyped search or a partial scan. Deliberately does NOT
      // touch the cart — Escape should never destroy a bill.
      e.preventDefault();
      setQ('');
      setActiveIdx(0);
      return;
    }
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
      // ---- LOCAL CATALOG FIRST (Phase 4) -------------------------------
      //
      // When a catalog has been synced, an exact barcode resolves from SQLite
      // with no network call at all. This is what makes scanning work during
      // an outage. Access goes through useLocalCatalog -> catalog-service, so
      // window.retailos is never touched from this component.
      if (localCatalog.ready) {
        const local = await localCatalog.lookup(raw);
        if (local && local.barcode && local.barcode.toLowerCase() === query) {
          addVariant(toPickerVariant(local), 'barcode-scan');
          return;
        }
        // A local SKU hit is manual entry, not a scan — same rule as below.
        if (local) {
          addVariant(toPickerVariant(local), 'manual');
          return;
        }
        // Not in the local catalog: fall through to the online result set
        // rather than failing. Never silently turn every scan into a request.
      }

      // Barcode is checked FIRST and separately from SKU. A scanner emits a
      // barcode, so only that match counts as 'barcode-scan' and is subject
      // to the duplicate rule. Checking it first also makes precedence
      // explicit when a string happens to be one variant's barcode and
      // another's SKU — the scanner's reading wins.
      const barcodeMatch = variants.find(
        (v) => v.barcode && v.barcode.toLowerCase() === query,
      );
      if (barcodeMatch) {
        addVariant(barcodeMatch, 'barcode-scan');
        return;
      }
      // An exact SKU typed by hand is deliberate manual entry, not a scan —
      // it keeps the pre-existing increment behaviour.
      const skuMatch = variants.find((v) => v.sku.toLowerCase() === query);
      if (skuMatch) {
        addVariant(skuMatch, 'manual');
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
  // Context (store / customer / salesperson) is collapsed by default: most
  // bills are walk-in, no salesperson, at the terminal's own store, and should
  // cost the cashier zero interaction.
  const [editingContext, setEditingContext] = useState(false);

  /**
   * What KIND of transaction this is. Defaults to a plain sale.
   *
   * Only `sale` is supported end to end today. The server has no concept of a
   * transaction type at all — `Sale` carries a status (completed / voided) and
   * nothing else, `SaleCreate` demands at least one line with quantity > 0, so
   * a return (negative quantity) is rejected by the schema and an advance (no
   * goods) cannot even be expressed.
   *
   * The selector is here because the counter needs it, but the other three
   * modes REFUSE TO SAVE rather than writing a sale that lies about what it
   * is. A return recorded as an ordinary sale would add stock it should
   * remove and take money it should return.
   */
  const [txnType, setTxnType] = useState<TxnType>('sale');
  const txn = TXN_TYPES.find((t) => t.id === txnType) ?? TXN_TYPES[0];
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDue, setConfirmDue] = useState(false);
  // Internal id of the locally-committed sale. Survives a network failure,
  // so the receipt can be rendered from SQLite when the server never replied.
  // Id of the last locally-committed sale. A ref rather than state: the save
  // mutation's onError closes over a stale state value, and nothing renders
  // from this — it only decides which receipt route to open.
  const lastCommittedSaleIdRef = useRef<string | null>(null);

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
        const localId = lastCommittedSaleIdRef.current;
        resetBillState();
        // The sale is durable locally even though the server never replied.
        // Show that receipt rather than leaving the counter with nothing.
        if (localId) {
          navigate(`/sales/local/${localId}/invoice`);
          return;
        }
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
    // Same gate as F7 and the button: a credit sale is confirmed however it
    // was triggered, so the guard cannot be bypassed by pressing a different
    // key for the same action.
    requestSave();
  }

  // Screen-local shortcuts — the "why" for each key:
  //   F7       = Save Bill (Marg convention: save + print in one action)
  //   F10      = Print — saves the current cart, receipt prints after success
  //   F3       = Hold Bill  (park cart, serve next customer, resume later)
  //   Shift+F3 = open the Held Bills panel to resume one
  useHotkey('F7', () => requestSave());
  useHotkey('F10', () => onPrint());
  //   F4       = jump to Amount received, so cash can be keyed without the mouse
  useHotkey('F4', () => {
    amountRef.current?.focus();
    amountRef.current?.select();
  });
  useHotkey('F3', (e) => {
    if (e.shiftKey) {
      setHeldOpen(true);
    } else {
      onHold();
    }
  });

  /**
   * The save entry point for the button and F7.
   *
   * Runs the cheap validations first so a problem is reported immediately
   * rather than behind a dialog, then asks for confirmation ONLY when the
   * bill leaves money uncollected. Everything else goes straight through.
   */
  function requestSave(): void {
    if (lines.length === 0) {
      setError('Add at least one product to the bill.');
      return;
    }
    if (isDue) {
      setError(null);
      setConfirmDue(true);
      return;
    }
    void onSave();
  }

  async function onSave(): Promise<void> {
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

    const clientUuid = newClientUuid();
    // Captured synchronously — setState is async and cannot be read back below.
    let committedSaleId: string | null = null;
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
      // replay from the offline queue collapses to a single sale row. The
      // SAME key is used for the local SQLite row id, so the local and
      // remote records are provably the same sale.
      client_uuid: clientUuid,
    };

    // ---- PHASE 4: LOCAL-FIRST COMMIT ------------------------------------
    //
    // The sale is written to SQLite BEFORE any network call. Once this
    // returns ok, the bill is durable: it survives a crash, a power cut and
    // an indefinite outage, and it is already queued for sync. The network
    // is no longer on the critical path of completing a bill.
    //
    // Previously an offline bill was pushed to a localStorage queue and the
    // form cleared with NO receipt shown — a cashier was left holding cash
    // with nothing to hand the customer. That path is gone.
    if (isLocalCheckoutAvailable()) {
      const local = await commitLocalSale({
        clientUuid,
        lines,
        totals,
        paymentMethod: method,
        amountPaid: paidNum,
        storeId: storeId || null,
        terminalId: null, // local FK into `terminal`; identity travels as terminalUuid
        // THE PHASE 5E INVARIANT. The session open RIGHT NOW, at the moment
        // the bill is rung up, travels with the sale. It is never re-resolved
        // at sync time — that is what moved last night's takings into today's
        // shift and corrupted the cash reconciliation of both days.
        daySessionId: sessionQuery.data?.id ?? null,
        terminalUuid: deviceIdentity?.deviceUuid ?? null,
        occurredAt: new Date().toISOString(),
        // These are SERVER uuids. They are recorded in dedicated non-FK
        // columns (migrations 004/005) rather than the local FK columns, so
        // a bill can name its customer and salesperson before those tables
        // are synced locally. Dropping them here made them unrecoverable.
        customerId: customerId || null,
        salespersonUserId: salespersonId || null,
        paymentReference: method === 'cash' ? null : reference.trim() || null,
        notes: notes.trim() || null,
      });

      if (!local.ok) {
        // Refuse rather than proceed. A bill we cannot store locally is a
        // bill we could lose, and losing it silently is worse than stopping.
        setError(local.error ?? 'Could not save the bill locally.');
        return;
      }

      committedSaleId = local.saleId;
      lastCommittedSaleIdRef.current = local.saleId;
    }

    // Offline: the bill is already durable locally. Keep the existing
    // localStorage queue as well — Phase 5 will migrate it to the SQLite
    // outbox, and removing it now would drop bills mid-upgrade.
    if (!navigator.onLine) {
      // Keep the legacy localStorage queue as a second belt — Phase 5 will
      // retire it. Removing it now would drop bills mid-upgrade.
      enqueueBill(body);
      resetBillState();

      // THE FIX: the customer gets a receipt. The sale is already durable in
      // SQLite, so this renders from local data with no network at all.
      if (committedSaleId) {
        navigate(`/sales/local/${committedSaleId}/invoice`);
        return;
      }
      setFlash({
        kind: 'success',
        text: 'Bill saved offline. It will sync when the connection returns.',
      });
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

  const storeLabel =
    storesQuery.data?.items.find((st) => st.id === storeId)?.name ?? 'No store selected';

  /**
   * The customer's rate for everything in the cart.
   *
   * Asked of the server, never computed here — /price-lists/resolve runs the
   * SAME function the sale service uses when it writes the line, so the price
   * on screen and the price on the bill cannot diverge.
   *
   * Re-resolved when the customer changes, because switching from walk-in to a
   * wholesale account is exactly when every price on screen should move.
   */
  const cartVariantIds = lines.map((l) => l.variant_id);
  const pricingQuery = useQuery({
    queryKey: ['resolve-prices', customerId ?? 'walk-in', cartVariantIds.join(',')],
    queryFn: () => resolvePrices(cartVariantIds, customerId || null),
    enabled: cartVariantIds.length > 0,
  });
  const pricing = useMemo(() => {
    const m = new Map<string, ResolvedPrice>();
    for (const r of pricingQuery.data ?? []) m.set(r.variant_id, r);
    return m;
  }, [pricingQuery.data]);

  // Apply the resolved rate to any line still sitting at the shelf price. A
  // line the cashier has edited by hand is left alone — a negotiated rate must
  // survive the customer being attached afterwards.
  useEffect(() => {
    if (pricing.size === 0) return;
    setLines((ls) =>
      ls.map((l) => {
        const r = pricing.get(l.variant_id);
        if (!r) return l;
        const atBase = Number(l.unit_price) === Number(r.base_price);
        return atBase && Number(l.unit_price) !== Number(r.price)
          ? { ...l, unit_price: r.price }
          : l;
      }),
    );
  }, [pricing]);

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
            'pointer-events-none fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium shadow-glass-lg backdrop-blur-xl',
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
        description="Scan or search to add items, then take payment."
        actions={
          <div className="flex items-center gap-2">
            {/* Held-bills pill: shown whenever there's at least one parked
                bill so the operator can never forget about them. Click or
                press Shift+F3 to open the resume panel. */}
            {heldCount > 0 && (
              <button
                type="button"
                onClick={() => setHeldOpen(true)}
                className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-400/70 hover:bg-amber-500/20"
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

      {/*
        Terminal context — one line, not two rows of form fields.

        WHY: this block previously carried four controls (store, customer,
        salesperson code, salesperson) across two rows, consuming ~190px above
        the fold on a 1366x768 shop monitor and pushing the cart to roughly
        three visible rows. A six-item bill did not fit on screen.

        THE STORE IS NOT A FORM FIELD. A terminal sits in one shop and never
        moves, but the two M.S. Mall branches carry DIFFERENT GSTINs and
        separate invoice series — so a stray click on a dropdown put the wrong
        tax identity on a legal invoice. It is now read-only context with a
        deliberate "Change" action behind it.

        Customer and salesperson remain fully available; they are simply
        collapsed until needed, because most bills are walk-in with no
        salesperson and should cost zero interaction.
      */}
      <GlassCard className="px-4 py-3">
        {/*
          Summary and editor are mutually exclusive. Rendering both at once
          stated the same three facts twice — once as text and again as the
          form fields holding them.
        */}
        {!editingContext && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {/*
            Transaction type comes FIRST because it changes what every other
            control on the screen means. A quantity, a payment and a total all
            reverse sign between a sale and a return.
          */}
          <label className="flex items-center gap-2">
            <span className="sr-only">Transaction type</span>
            <select
              value={txnType}
              onChange={(e) => {
                const next = e.target.value as TxnType;
                const target = TXN_TYPES.find((t) => t.id === next);
                // Modes that live on another screen navigate instead of
                // switching this one into a state it cannot serve.
                if (target?.route) {
                  navigate(target.route);
                  return;
                }
                setTxnType(next);
              }}
              className="rounded-lg border border-border-strong bg-surface-muted px-2 py-1 text-sm font-medium text-white focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/25"
            >
              {TXN_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="font-medium text-white">{storeLabel}</span>
            <button
              type="button"
              onClick={() => setEditingContext(true)}
              className="rounded px-2 py-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              Change
            </button>
          </div>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setEditingContext(true)}
            className="flex items-center gap-2 rounded px-1 py-1 text-left hover:text-white"
          >
            <Users className="h-4 w-4 shrink-0 text-slate-500" />
            <span className={customerName ? 'text-white' : 'text-slate-500'}>
              {customerName ?? 'Walk-in customer'}
            </span>
          </button>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setEditingContext(true)}
            className="flex items-center gap-2 rounded px-1 py-1 text-left hover:text-white"
          >
            <Award className="h-4 w-4 shrink-0 text-slate-500" />
            <span className={salespersonName ? 'text-white' : 'text-slate-500'}>
              {salespersonName ?? 'Credit to cashier'}
            </span>
          </button>

          {/*
            Day-session state sits on the SAME row, pushed right.

            It was on a row of its own, which left a band of dead space either
            side of it and grew the card for no information gained.
          */}
          <div className="ml-auto shrink-0">
            <SessionBanner
              hasStore={!!storeId}
              open={!!sessionOpen}
              loading={sessionLoading}
            />
          </div>
        </div>
        )}

        {editingContext && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400">Bill context</span>
            <div className="ml-auto shrink-0">
              <SessionBanner
                hasStore={!!storeId}
                open={!!sessionOpen}
                loading={sessionLoading}
              />
            </div>
          </div>
        )}

        {/* An unsupported mode says so here, once, instead of failing at save. */}
        {!txn.ready && txn.needs && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b className="font-semibold">{txn.label} is not wired up yet.</b>{' '}
              {txn.needs} Saving is blocked in this mode — recording it as an
              ordinary sale would move stock and money the wrong way.
            </span>
          </div>
        )}

        {/* Expanded only when something actually needs changing. */}
        {editingContext && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-3">
            <Select
              label="Store"
              placeholder="— Select store —"
              options={(storesQuery.data?.items ?? []).map((st) => ({
                label: `${st.code} · ${st.name}`,
                value: st.id,
              }))}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              hint="Different branches bill under different GSTINs."
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
              hint="Required only when a bill leaves an unpaid balance."
            />
            {/*
              Points, shown only once a customer is named.

              Read-only here on purpose. Redemption is a decision with a rupee
              consequence, and a control that could spend a balance sitting
              beside the customer dropdown is one mis-click away from giving
              away a discount nobody asked for.
            */}
            <LoyaltyChip customerId={customerId} />
            {/*
              One salesperson control, not two.

              A code input and a dropdown previously sat side by side for the
              same value. This accepts either: type STF-0001 and press Enter,
              or pick from the list.
            */}
            <div className="space-y-2">
              <Select
                label="Salesperson"
                placeholder="— Credit to cashier —"
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
              <input
                type="text"
                placeholder="…or type STF-0001 and press Enter"
                value={staffCodeBuffer}
                onChange={(e) => setStaffCodeBuffer(e.target.value)}
                onKeyDown={onStaffCodeKey}
                className="w-full rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cobalt-400 focus:outline-none"
              />
              {staffLookupError && (
                <p className="text-xs text-rose-300">{staffLookupError}</p>
              )}
            </div>
          </div>
        )}

        {editingContext && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setEditingContext(false)}>
              Done
            </Button>
          </div>
        )}
      </GlassCard>

      {/*
        Main split.

        `min-w-0` on both children is load-bearing, not cosmetic. A grid item
        defaults to `min-width:auto`, so the widest unbreakable thing inside it
        (a money figure, the payment-method row) sets a floor the column will
        not go below — the 420px rail then overflowed the viewport and the
        right edge of every amount was clipped off screen.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left — scanner + the bill itself */}
        <div className="min-w-0 space-y-4">
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
                  <div className="text-xs text-slate-500">
                    Or type SKU / product name and press Enter
                  </div>
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors',
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
                // 56px tall, 17px type, a permanent 2px brand edge. This is
                // the single most-used control on the screen and it was the
                // same size as every other input.
                'w-full rounded-lg border-2 bg-white/[0.02] px-4 h-14 font-mono text-item text-slate-100 placeholder:text-slate-500',
                'transition-colors focus:outline-none',
                scannerFocused
                  ? 'border-cobalt-400 ring-2 ring-cobalt-400/25'
                  : 'border-cobalt-500/40',
              )}
            />

            {/* Just-added flash so a scan visibly confirms even when the row
                scrolls out of view. */}
            {lastAddedSku && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Added <span className="font-mono">{lastAddedSku}</span> to bill
              </div>
            )}

            {/*
              A catalog that failed to load is always worth saying, searching
              or not — nothing can be scanned until it is fixed.
            */}
            {(summariesQuery.isError || variantsQuery.isError) && !showResults && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <span>Catalog failed to load — scanning will not match.</span>
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
            )}

            {/*
              Search results — rendered ONLY while something is typed.

              This block used to be permanent. With an empty query `filtered`
              falls back to `variants.slice(0, 30)` (see the memo above): the
              first thirty rows of the catalog in arbitrary order — not recent,
              not popular, not this shop's fast movers. It told the cashier
              nothing, and at ~288px tall it pushed the actual bill below the
              fold on a 1366x768 counter monitor, which is why the cart was
              never on screen.

              Nothing is deleted. The same list, the same keyboard navigation,
              the same click-to-add — it simply stops occupying the screen when
              there is no query to answer.
            */}
            {showResults && (summariesQuery.isLoading || variantsQuery.isLoading) ? (
              <div className="mt-4 text-sm text-slate-400">Loading catalog…</div>
            ) : showResults && (summariesQuery.isError || variantsQuery.isError) ? (
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
            ) : showResults && filtered.length > 0 ? (
              <ul className="mt-3 max-h-[19rem] overflow-y-auto rounded-xl border border-border">
                {filtered.map((v, idx) => (
                  <li
                    key={v.variant_id}
                    onClick={() => addVariant(v)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-white/[0.03]',
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
            ) : showResults ? (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-border px-4 py-6 text-center text-sm text-slate-400">
                <span>
                  {variants.length === 0
                    ? 'No active products in the catalog. Add one from Catalog → Products, or activate an existing product.'
                    : `Nothing matches “${q}”.`}
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
            ) : null}
          </GlassCard>

          <GlassCard className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Bill items ({lines.length})
              </span>
              {lines.length > 0 && (
                <span className="money text-xs text-slate-500">
                  {totalUnits.toFixed(totalUnits % 1 === 0 ? 0 : 2)} units
                </span>
              )}
            </div>

            {lines.length === 0 ? (
              /*
                An empty bill is the resting state of this screen, not an
                error. It points at the one thing to do next rather than
                reporting that nothing has happened.
              */
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                <ScanBarcode className="h-7 w-7 text-slate-600" />
                <div className="text-sm font-medium text-slate-300">
                  Scan a barcode to start the bill
                </div>
                <div className="text-xs text-slate-500">
                  Or type a SKU or product name in the box above and press Enter.
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500">
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
                    {/*
                      Newest line first — DISPLAY ORDER ONLY.

                      `lines` itself is untouched and still goes to the server
                      in entry order; this reverses a copy. After a scan the
                      cashier checks exactly one thing — did the right item go
                      in? — and on a long bill the answer was at the bottom,
                      out of view.
                    */}
                    {[...lines].reverse().map((l) => {
                      // Tax-inclusive: the "total" column is the
                      // post-discount extended price — GST is already
                      // embedded in unit_price and shown separately in
                      // the totals card below.
                      //
                      // The same arithmetic as before, moved into a tested
                      // module so the MRP/saving figures beside it cannot
                      // drift from the line total they sit next to.
                      const presented = presentLine(l);
                      const total = presented.lineTotal;
                      return (
                        <tr
                          key={l.variant_id}
                          className="border-b border-border/40 align-middle last:border-b-0"
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-white">
                              {l.product_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {l.variant_name} ·{' '}
                              <span className="font-mono">{l.sku}</span>
                            </div>
                            {/* The label's own story: what it was marked at,
                                and what the customer is saving. Shown only
                                when there IS a saving — "Saved Rs.0" is
                                noise, and a line sold above MRP is not a
                                discount. */}
                            {/* Say WHERE a non-shelf price came from. Without
                                this the cashier sees 700 on a 899 label and
                                cannot tell a rate card from a mistake. */}
                            {(() => {
                              const r = pricing.get(l.variant_id);
                              if (!r || r.source !== 'price_list') return null;
                              if (Number(l.unit_price) !== Number(r.price)) return null;
                              return (
                                <div className="mt-0.5 text-xs text-brand-400">
                                  Price list rate · shelf ₹
                                  {Number(r.base_price).toFixed(2)}
                                </div>
                              );
                            })()}
                            {presented.showsSaving && (
                              <div className="mt-1 text-xs">
                                <span className="text-slate-500 line-through">
                                  MRP ₹{(presented.mrpTotal ?? 0).toFixed(2)}
                                </span>
                                <span className="ml-2 text-emerald-300">
                                  Save ₹{(presented.savedAgainstMrp ?? 0).toFixed(2)}
                                </span>
                              </div>
                            )}
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
                          <td className="px-3 py-2 text-right">
                            <span className="money text-base font-semibold text-white">
                              ₹{total.toFixed(2)}
                            </span>
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
        <GlassCard className="sticky top-4 h-fit min-w-0 p-4">
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
            {/*
              One number dominates.

              Subtotal, discount and GST must be present on a tax invoice but
              nobody reads them aloud; the payable is the only figure the
              cashier says to the customer and the only one they must not
              misread. It was previously set at the same weight as the three
              lines above it.
            */}
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Total payable
              </span>
              <span className="money text-total font-semibold leading-none text-white">
                <span className="text-xl text-slate-500">₹</span>
                {totals.grand.toFixed(2)}
              </span>
            </div>
            {/* What the customer saved against the printed MRP. Shown only
                when at least one line has an MRP — a confident "You saved
                Rs.0.00" on a cart with no MRP data would be misleading. */}
            {savings.known && savings.totalSaved > 0 && (
              <div className="mt-1 flex items-center justify-between rounded-lg bg-emerald-500/10 px-2 py-1">
                <span className="text-xs font-medium text-emerald-300">
                  You saved
                </span>
                <span className="font-mono text-sm font-semibold text-emerald-300">
                  ₹{savings.totalSaved.toFixed(2)}
                </span>
              </div>
            )}
          </dl>

          {/* Payment method */}
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
              ref={amountRef}
              label="Amount received"
              type="number"
              step="0.01"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <QuickChip
                onClick={() => setAmountPaid(totals.grand.toFixed(2))}
                label="Full"
                accent="cobalt"
              />
              <QuickChip onClick={() => setAmountPaid('0')} label="All due" accent="amber" />
              {/* Derived from THIS bill rather than a fixed list. A flat
                  Rs.100/200 chip is useless on a Rs.240 bill — it is less
                  than the total and can never be the amount tendered. These
                  are the notes a customer would actually hand over. */}
              {cashSuggestions(totals.grand).map((v) => (
                <QuickChip
                  key={v}
                  onClick={() => setAmountPaid(v.toFixed(2))}
                  label={`₹${v.toFixed(2).replace(/\.00$/, '')}`}
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

          <div className="mt-4 space-y-2">
            <Button
              size="lg"
              className="w-full"
              loading={busy}
              // Blocked outside `sale`. The server cannot represent the other
              // three, so the only alternative to disabling this is writing a
              // sale that misstates what happened.
              disabled={busy || lines.length === 0 || !txn.ready}
              leadingIcon={<ReceiptText className="h-4 w-4" />}
              onClick={requestSave}
            >
              {/*
                The shortcut rides on the control it triggers.

                A permanent line of "F2 new · F4 amount · F7 save…" at the top
                of the page is read once and then costs vertical space every
                shift after that. On the button, the shortcut is learned by
                using the software.
              */}
              {isDue ? 'Save bill (with due)' : 'Save & print bill'}
              <Kbd>F10</Kbd>
            </Button>
            {/* Clearing is the only irreversible thing a cashier can do to a
                cart, and previously the only way to undo a mis-scan was to
                delete every line by hand. Disabled on an empty cart so it
                cannot be pressed for no reason. */}
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy || lines.length === 0}
              leadingIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => setConfirmClear(true)}
            >
              Clear bill
            </Button>
            {/* The remaining shortcuts, once, small, at the foot of the rail —
                where they cost nothing above the fold. */}
            <p className="pt-1 text-center text-xs text-slate-500">
              <span className="money">F2</span> new ·{' '}
              <span className="money">F3</span> hold ·{' '}
              <span className="money">F4</span> amount ·{' '}
              <span className="money">F9</span> today's bills
            </p>
          </div>
        </GlassCard>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear this bill?"
        description={`${lines.length} ${lines.length === 1 ? 'item' : 'items'} will be removed. This cannot be undone — use Hold bill (F3) instead if you want to come back to it.`}
        confirmLabel="Clear bill"
        destructive
        onConfirm={() => {
          resetBillState();
          setAmountPaid('');
          setConfirmClear(false);
          setFlash({ kind: 'info', text: 'Bill cleared.' });
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
      />

      {/* Confirmation is deliberately limited to bills that leave money
          uncollected. A fully paid sale stays a single keypress, because a
          modal on every bill is friction a busy counter cannot afford — but
          money walking out the door on credit deserves a deliberate yes. */}
      <ConfirmDialog
        open={confirmDue}
        onClose={() => setConfirmDue(false)}
        title="Save with an outstanding balance?"
        description={`${customerName ?? 'This customer'} will owe ₹${balanceDue.toFixed(2)} of the ₹${totals.grand.toFixed(2)} total. It will appear under Billing → Outstanding to collect later.`}
        confirmLabel="Save with due"
        onConfirm={() => {
          setConfirmDue(false);
          void onSave();
        }}
      />
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
      <div className="whitespace-nowrap rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
        Select a store to begin.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="whitespace-nowrap rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
        Checking day session…
      </div>
    );
  }
  if (!open) {
    return (
      <a
        href="#/day-session"
        className="flex items-center gap-3 whitespace-nowrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/15"
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
    <div className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
      <DoorOpen className="h-4 w-4" />
      Day session open
    </div>
  );
}

/** A keycap, sized to sit inside a button without changing its height. */
function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="ml-2 rounded border border-current/40 px-2 py-1 text-xs font-medium opacity-70">
      {children}
    </span>
  );
}

/**
 * The four things a counter can record.
 *
 * `needs` names the server work each one is missing, so the gap is stated in
 * the code rather than discovered when a shopkeeper records a return and the
 * stock goes the wrong way.
 */
type TxnType = 'sale' | 'return' | 'advance_received' | 'advance_return';

const TXN_TYPES: {
  id: TxnType;
  label: string;
  hint: string;
  ready: boolean;
  /** Where this mode actually happens, when it is not the cart. */
  route?: string;
  needs?: string;
}[] = [
  {
    id: 'sale',
    label: 'Sale',
    hint: 'Goods out, money in.',
    ready: true,
  },
  {
    id: 'return',
    label: 'Return',
    hint: 'Goods back, money out.',
    ready: true,
    // A return is always against ONE invoice, so it cannot be rung up in a
    // cart — the cashier picks the bill first. Selecting this mode routes
    // there rather than trying to make one screen do two opposite jobs.
    route: '/sales?pick=return',
  },
  {
    id: 'advance_received',
    label: 'Advance received',
    hint: 'Money in, no goods yet.',
    ready: false,
    needs:
      'An advance is money held against no invoice. The server requires at least one line on every sale, so there is currently no way to store one.',
  },
  {
    id: 'advance_return',
    label: 'Advance returned',
    hint: 'Refunding a held advance.',
    ready: false,
    needs:
      'Depends on advances existing first, plus a link back to the advance being refunded so the customer ledger stays balanced.',
  },
];

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
      className={cn('rounded-md border px-3 py-1 text-xs font-medium', cls)}
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
      <dt
        className={
          strong
            ? 'text-xs font-medium uppercase tracking-wide text-slate-400'
            : 'text-slate-400'
        }
      >
        {label}
      </dt>
      <dd
        className={cn(
          'font-mono money',
          toneClass,
          // The grand total is the number both the cashier and the customer
          // look at. At 34px it can be read across the counter.
          strong && 'text-total font-bold leading-none text-white',
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
