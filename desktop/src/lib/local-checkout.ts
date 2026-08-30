/**
 * Local-first checkout (Phase 4).
 *
 * THE CENTRAL CHANGE: a sale is committed to SQLite BEFORE any network call.
 * The network is no longer on the critical path of completing a bill.
 *
 *   validate → commit locally (atomic) → receipt → push in background
 *
 * Previously the flow was network-first: `createSale()` over HTTP, and on a
 * network error the bill was pushed onto a localStorage queue and the form
 * cleared WITHOUT showing a receipt. That left a cashier with a paying
 * customer and no document. This module removes that failure mode.
 *
 * ── MONEY ──────────────────────────────────────────────────────────────────
 * The existing `computeTotals()` in Billing.tsx does tax-inclusive GST maths
 * in floating point. That is NOT changed here — altering it would silently
 * change every bill's tax, which is explicitly forbidden. Instead the already
 * computed rupee values are converted to integer paise at THIS boundary, so
 * everything stored in SQLite is integer. The float maths upstream remains a
 * documented limitation.
 */

export interface CheckoutLine {
  /** SERVER variant uuid in both the online picker and the local catalog
   *  path. This is the value POST /sales requires as lines[].variant_id, so
   *  it must reach SQLite — see migration 005. */
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  quantity: number;
  discount_pct: number;
  /** Label MRP in rupees. Absent when the source did not supply one. */
  mrp?: string | null;
  hsn_code?: string | null;
}

export interface CheckoutTotals {
  gross: number;
  discount: number;
  subtotal: number;
  tax: number;
  grand: number;
}

export interface LocalCheckoutInput {
  /** Client-generated UUID. Doubles as the idempotency key, so a retry of the
   *  same bill can never create a second sale. */
  clientUuid: string;
  lines: CheckoutLine[];
  totals: CheckoutTotals;
  paymentMethod: string;
  /** What the customer actually handed over. May be less than the total —
   *  the shortfall becomes balance due, exactly as the online flow does. */
  amountPaid: number;
  storeId: string | null;
  terminalId: string | null;
  customerId: string | null;
  /** Server user uuid credited with the sale. Unrecoverable once the shift
   *  ends, so it is captured here rather than reconstructed later. */
  salespersonUserId: string | null;
  /** Card/UPI transaction reference. Not a card number — see below. */
  paymentReference: string | null;
  notes: string | null;
  /** SERVER day_session open AT THE MOMENT OF SALE (Phase 5E). Captured now
   *  and never re-resolved during synchronisation: resolving later is exactly
   *  what books an overnight bill into the following day's shift. */
  daySessionId?: string | null;
  /** device_uuid of this till. Null means "unknown terminal" and must never
   *  block a bill — an unattributed sale is a reporting gap, a refused sale
   *  is a lost customer. */
  terminalUuid?: string | null;
  /** True occurrence time (ISO). Defaults to now at commit. */
  occurredAt?: string | null;
}

export interface LocalCheckoutResult {
  ok: boolean;
  saleId: string | null;
  error?: string;
}

/**
 * Rupees to integer paise.
 *
 * Rounds rather than truncating. `Number.EPSILON` guards the classic
 * `1.005 * 100 = 100.49999...` float artefact, which would otherwise lose a
 * paisa on roughly one line in a hundred.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round((rupees + Number.EPSILON) * 100);
}

/** Percentage to basis points: 5% -> 500, 12.5% -> 1250. */
export function percentToBasisPoints(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round((percent + Number.EPSILON) * 100);
}

/**
 * Per-line money, derived with the SAME formula Billing already uses so the
 * stored figures reconcile exactly with what the cashier saw on screen.
 *
 *   gross      = price × qty
 *   discount   = gross × discount_pct/100
 *   lineTotal  = gross − discount        ← tax-INCLUSIVE, what is paid
 *   net        = lineTotal / (1 + rate)  ← pre-tax base
 *   tax        = lineTotal − net         ← embedded GST
 */
export function computeLineMoney(line: CheckoutLine): {
  unitPricePaise: number;
  discountPaise: number;
  taxRateBp: number;
  taxPaise: number;
  lineTotalPaise: number;
} {
  const price = Number(line.unit_price) || 0;
  const rate = Number(line.tax_rate) || 0;

  const gross = price * line.quantity;
  const discount = gross * (line.discount_pct / 100);
  const lineTotal = gross - discount;
  const divisor = 1 + rate / 100;
  const net = divisor !== 0 ? lineTotal / divisor : lineTotal;
  const tax = lineTotal - net;

  return {
    unitPricePaise: rupeesToPaise(price),
    discountPaise: rupeesToPaise(discount),
    taxRateBp: percentToBasisPoints(rate),
    taxPaise: rupeesToPaise(tax),
    lineTotalPaise: rupeesToPaise(lineTotal),
  };
}

/** True when the Electron database bridge is present. */
export function isLocalCheckoutAvailable(): boolean {
  return typeof window !== 'undefined' && window.retailos?.db !== undefined;
}

export interface ValidationFailure {
  field: string;
  message: string;
}

/**
 * Validate before committing. A bill that cannot be represented correctly must
 * be refused at the counter, not written and reconciled later.
 */
export function validateCheckout(input: LocalCheckoutInput): ValidationFailure[] {
  const problems: ValidationFailure[] = [];

  if (input.lines.length === 0) {
    problems.push({ field: 'lines', message: 'Cart is empty.' });
  }
  for (const [i, line] of input.lines.entries()) {
    if (!(line.quantity > 0)) {
      problems.push({ field: `lines[${i}].quantity`, message: `${line.product_name}: quantity must be greater than zero.` });
    }
    if (!Number.isFinite(Number(line.unit_price)) || Number(line.unit_price) < 0) {
      problems.push({ field: `lines[${i}].unit_price`, message: `${line.product_name}: price is invalid.` });
    }
    if (line.discount_pct < 0 || line.discount_pct > 100) {
      problems.push({ field: `lines[${i}].discount_pct`, message: `${line.product_name}: discount must be between 0 and 100%.` });
    }
  }
  if (input.totals.grand < 0) {
    problems.push({ field: 'totals', message: 'Bill total cannot be negative.' });
  }
  if (input.amountPaid < 0) {
    problems.push({ field: 'amountPaid', message: 'Amount paid cannot be negative.' });
  }

  return problems;
}

/**
 * Commit the sale to SQLite.
 *
 * Everything — sale, items, payment and the sync-queue entry — lands in ONE
 * transaction inside the main process (see sale-repository.ts). Either the
 * whole bill exists or none of it does. No orphan items, no payment without a
 * sale, no sale that was never queued for sync.
 *
 * The returned id is the internal transaction id and is stable forever; the
 * human-readable invoice number is assigned separately and later.
 */
export async function commitLocalSale(
  input: LocalCheckoutInput,
): Promise<LocalCheckoutResult> {
  const bridge = typeof window !== 'undefined' ? window.retailos?.db : undefined;
  if (!bridge) {
    return { ok: false, saleId: null, error: 'Local database is not available.' };
  }

  const problems = validateCheckout(input);
  if (problems.length > 0) {
    return { ok: false, saleId: null, error: problems[0].message };
  }

  const items = input.lines.map((line) => {
    const money = computeLineMoney(line);
    return {
      // The cart's variant_id is a SERVER uuid, not a local product row id.
      // Passing it as productId would fail the local foreign key, so the
      // reference is carried in sku/productName instead until Phase 5 links
      // the catalog rows properly.
      productId: null,
      // ...but the SERVER variant uuid is carried explicitly. Losing it made
      // the sale unsyncable, because POST /sales requires lines[].variant_id
      // and resolving it later by SKU is ambiguous across stores and unsafe
      // after a catalog re-sync.
      serverVariantId: line.variant_id,
      productName: `${line.product_name}${line.variant_name ? ` — ${line.variant_name}` : ''}`,
      sku: line.sku,
      hsnCode: line.hsn_code ?? null,
      quantity: line.quantity,
      mrpPaise: line.mrp ? rupeesToPaise(Number(line.mrp)) : 0,
      unitPricePaise: money.unitPricePaise,
      // The percentage AS ENTERED. money.discountPaise records what it came
      // to; this records what was asked for. Deriving one from the other
      // rounds away the cashier's actual input.
      discountPctBp: percentToBasisPoints(line.discount_pct),
      discountPaise: money.discountPaise,
      taxRateBp: money.taxRateBp,
      taxPaise: money.taxPaise,
      lineTotalPaise: money.lineTotalPaise,
    };
  });

  // Payment is recorded as method + amount only. No card number, no CVV, no
  // gateway credential ever reaches this database.
  // The reference is the gateway/UPI transaction id the cashier types in —
  // the same value the online payload already carries. It is what makes a
  // non-cash payment reconcilable against a bank statement, so it must
  // survive offline too.
  const payments =
    input.amountPaid > 0
      ? [
          {
            method: input.paymentMethod,
            amountPaise: rupeesToPaise(input.amountPaid),
            reference: input.paymentReference,
          },
        ]
      : [];

  try {
    const res = (await bridge.createSale({
      id: input.clientUuid,
      terminalId: input.terminalId,
      storeId: input.storeId,
      customerId: input.customerId,
      salespersonUserId: input.salespersonUserId,
      daySessionId: input.daySessionId ?? null,
      terminalUuid: input.terminalUuid ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      status: 'COMPLETED',
      subtotalPaise: rupeesToPaise(input.totals.subtotal),
      discountPaise: rupeesToPaise(input.totals.discount),
      taxPaise: rupeesToPaise(input.totals.tax),
      totalPaise: rupeesToPaise(input.totals.grand),
      notes: input.notes,
      items,
      payments,
    })) as { ok: true; data: string } | { ok: false; error: string };

    if (!res.ok) return { ok: false, saleId: null, error: res.error };
    return { ok: true, saleId: res.data };
  } catch (err) {
    return {
      ok: false,
      saleId: null,
      error: err instanceof Error ? err.message : 'Local commit failed.',
    };
  }
}

/** Shape returned by the main process for a locally-committed sale. Mirrors
 *  SaleRecord in electron/database/repositories/sale-repository.ts. */
export interface LocalSaleRecord {
  id: string;
  serverId: string | null;
  invoiceNumber: string | null;
  localReference: string | null;
  storeId: string | null;
  serverDaySessionId: string | null;
  occurredAt: string | null;
  terminalUuid: string | null;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  notes: string | null;
  status: string;
  createdAt: string;
  syncStatus: string;
  items: {
    id: string;
    productName: string;
    sku: string | null;
    serverVariantId: string | null;
    hsnCode: string | null;
    quantity: number;
    mrpPaise: number;
    unitPricePaise: number;
    discountPctBp: number;
    discountPaise: number;
    taxRateBp: number;
    taxPaise: number;
    lineTotalPaise: number;
  }[];
  payments: { id: string; method: string; amountPaise: number; reference: string | null }[];
}

/** Read a committed sale back for receipt rendering — works with no network. */
export async function getLocalSale(saleId: string): Promise<LocalSaleRecord | null> {
  const bridge = typeof window !== 'undefined' ? window.retailos?.db : undefined;
  if (!bridge) return null;
  try {
    const res = (await bridge.getSale(saleId)) as
      | { ok: true; data: LocalSaleRecord | null }
      | { ok: false; error: string };
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}
