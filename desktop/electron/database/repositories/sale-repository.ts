/**
 * Local sale persistence — the transaction primitive.
 *
 * NOT WIRED INTO BILLING IN THIS PHASE. Billing continues to POST to the API
 * and fall back to the localStorage queue exactly as before. This repository
 * exists so the shape, the atomicity and the sync enqueue are proven and
 * tested before anything depends on them.
 *
 * Atomicity: `create` writes the sale, its items, its payments and the sync
 * queue entry inside ONE transaction. Either the whole bill lands or none of
 * it does — there is no state where a sale exists without its lines, or where
 * a bill is saved locally but never queued for sync.
 */

import { randomUUID } from 'node:crypto';

import type { Db } from '../connection';
import { log } from '../logger';
import { SyncRepository } from './sync-repository';

export interface SaleItemInput {
  productId: string | null;
  productName: string;
  sku?: string | null;
  /** SERVER variant uuid. Without it the sale can never be pushed — the
   *  FastAPI contract requires lines[].variant_id. See migration 005. */
  serverVariantId?: string | null;
  /** Discount as entered, in basis points (30% -> 3000). Stored alongside the
   *  paise amount because the percentage cannot be recovered from the amount
   *  without rounding away the cashier's actual input. */
  discountPctBp?: number;
  /** Label MRP at sale time, snapshotted so a later price change cannot
   *  rewrite an issued bill. */
  mrpPaise?: number;
  hsnCode?: string | null;
  quantity: number;
  unitPricePaise: number;
  discountPaise?: number;
  taxRateBp?: number;
  taxPaise?: number;
  lineTotalPaise: number;
}

export interface PaymentInput {
  method: string;
  amountPaise: number;
  reference?: string | null;
}

export interface SaleInput {
  terminalId?: string | null;
  /** LOCAL store row id (FK). Null until stores are synced locally. */
  storeId?: string | null;
  /** SERVER store uuid. Recorded without a FK so a bill can name its store
   *  before the local store table is populated. */
  serverStoreId?: string | null;
  customerId?: string | null;
  /** SERVER customer uuid, same reasoning as serverStoreId. */
  serverCustomerId?: string | null;
  /** SERVER user uuid credited with the sale. Optional to the backend, but
   *  unrecoverable if it is not captured at the counter. */
  serverSalespersonUserId?: string | null;
  /** SERVER day_session uuid open WHEN THE SALE HAPPENED. Captured here and
   *  never resolved later — resolving at sync time is exactly what books an
   *  overnight bill into the wrong shift. */
  serverDaySessionId?: string | null;
  /** True occurrence time (ISO). Distinct from created_at; the server uses it
   *  to pick the invoice month. Defaults to the commit time. */
  occurredAt?: string | null;
  /** device_uuid of the till. NOT terminalId, which is a local FK. */
  terminalUuid?: string | null;
  status?: string;
  subtotalPaise: number;
  discountPaise?: number;
  taxPaise?: number;
  totalPaise: number;
  /**
   * Money off the WHOLE bill, applied after the lines are totalled.
   *
   * Kept apart from `discountPaise`, which is the sum of the per-line
   * discounts. Merging them would make the invoice unexplainable: a bill has
   * to show what came off each line and what came off the bill.
   */
  billDiscountPaise?: number;
  billDiscountReason?: string | null;
  /** The coupon code as typed, snapshotted — a coupon can be edited later. */
  couponCode?: string | null;
  /** Loyalty points spent. The server owns the ledger; this records the fact. */
  redeemPoints?: number;
  /** Signed rounding to the whole rupee: −40 or +60 paise, never both. */
  roundOffPaise?: number;
  notes?: string | null;
  items: SaleItemInput[];
  payments?: PaymentInput[];
  /** Optional caller-supplied id. Lets the renderer generate the UUID up front
   *  and reuse it as an idempotency key, matching how offline-bills.ts already
   *  works. Omit and one is generated here. */
  id?: string;
}

export interface SaleRecord {
  id: string;
  serverId: string | null;
  /** Server-allocated GST invoice number. Null until the sale syncs. */
  invoiceNumber: string | null;
  /** Printable offline reference, e.g. OFFLINE-A1B2C3-000042. Distinct from
   *  invoiceNumber by design — see migration 003. */
  localReference: string | null;
  storeId: string | null;
  serverStoreId: string | null;
  serverCustomerId: string | null;
  serverSalespersonUserId: string | null;
  serverDaySessionId: string | null;
  occurredAt: string | null;
  terminalUuid: string | null;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  billDiscountPaise: number;
  billDiscountReason: string | null;
  couponCode: string | null;
  redeemPoints: number;
  roundOffPaise: number;
  notes: string | null;
  status: string;
  totalPaise: number;
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

/** The six states a cashier can act on. */
export type LocalSyncState =
  | 'LOCAL'
  | 'QUEUED'
  | 'SYNCING'
  | 'SYNCED'
  | 'BLOCKED'
  | 'FAILED';

export interface LocalSaleSummary {
  id: string;
  localReference: string | null;
  invoiceNumber: string | null;
  serverId: string | null;
  totalPaise: number;
  createdAt: string;
  occurredAt: string | null;
  syncedAt: string | null;
  terminalUuid: string | null;
  serverDaySessionId: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  error: string | null;
  state: LocalSyncState;
}

/**
 * Turn the stored sale + queue row into one word a cashier understands.
 *
 * The server id is checked FIRST and deliberately: once the server has
 * acknowledged a sale it IS synced, even if the queue row was pruned or a
 * later bookkeeping step was interrupted. Reporting such a sale as unsynced
 * would send someone chasing money that is already banked.
 *
 * BLOCKED is kept distinct from FAILED because they need opposite responses:
 * blocked resolves itself once a day session is opened, whereas failed needs
 * a person. Collapsing them would hide that difference at exactly the moment
 * it matters.
 */
export function deriveSyncState(input: {
  serverId: string | null;
  saleSyncStatus: string;
  queueStatus: string | null;
  failureKind: string | null;
}): LocalSyncState {
  if (input.serverId) return 'SYNCED';
  if (input.saleSyncStatus === 'SYNCED') return 'SYNCED';
  if (input.queueStatus === null) return 'LOCAL';
  if (input.queueStatus === 'SYNCED') return 'SYNCED';
  if (input.queueStatus === 'PROCESSING') return 'SYNCING';
  if (input.failureKind === 'BLOCKED') return 'BLOCKED';
  if (input.queueStatus === 'FAILED') return 'FAILED';
  return 'QUEUED';
}

export class SaleRepository {
  private readonly sync: SyncRepository;

  constructor(private readonly db: Db) {
    this.sync = new SyncRepository(db);
  }

  /**
   * Persist a sale atomically and queue it for sync.
   *
   * Returns the internal UUID. That id is stable forever; `server_id` and
   * `invoice_number` are filled in later and are NOT part of identity.
   */
  create(input: SaleInput): string {
    const saleId = input.id ?? randomUUID();
    const now = new Date().toISOString();

    // Terminal segment of the offline reference. Prefers the operator-assigned
    // terminal code; falls back to the device UUID, which is unique per
    // install and never regenerated — so two terminals cannot collide.
    const device = this.db
      .prepare('SELECT device_uuid, terminal_code FROM device WHERE singleton_guard = 1')
      .get() as { device_uuid: string; terminal_code: string | null } | undefined;
    const terminalTag = (device?.terminal_code ?? device?.device_uuid ?? 'UNKNOWN')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase();

    const run = this.db.transaction(() => {
      // Allocate the offline reference INSIDE the sale transaction. If the
      // insert rolls back the counter rolls back with it, so a number is
      // never burned by a failed bill and never reused by a later one.
      const seq = this.db
        .prepare(
          `UPDATE local_sequence SET value = value + 1, updated_at = ?
            WHERE name = 'sale' RETURNING value`,
        )
        .get(now) as { value: number } | undefined;
      const sequenceValue = seq?.value ?? 1;
      const localReference = `OFFLINE-${terminalTag}-${String(sequenceValue).padStart(6, '0')}`;

      this.db
        .prepare(
          `INSERT INTO sale
             (id, terminal_id, store_id, customer_id, status,
              subtotal_paise, discount_paise, tax_paise, total_paise,
              bill_discount_paise, bill_discount_reason, coupon_code,
              redeem_points, round_off_paise,
              notes, local_reference, server_store_id, server_customer_id,
              server_salesperson_user_id, server_day_session_id, occurred_at,
              terminal_uuid, created_at, updated_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        )
        .run(
          saleId,
          input.terminalId ?? null,
          input.storeId ?? null,
          input.customerId ?? null,
          input.status ?? 'COMPLETED',
          input.subtotalPaise,
          input.discountPaise ?? 0,
          input.taxPaise ?? 0,
          input.totalPaise,
          input.billDiscountPaise ?? 0,
          input.billDiscountReason ?? null,
          input.couponCode ?? null,
          input.redeemPoints ?? 0,
          input.roundOffPaise ?? 0,
          input.notes ?? null,
          localReference,
          input.serverStoreId ?? null,
          input.serverCustomerId ?? null,
          input.serverSalespersonUserId ?? null,
          input.serverDaySessionId ?? null,
          // Falls back to the commit time, so a sale written from this phase
          // onward always carries an occurrence time.
          input.occurredAt ?? now,
          input.terminalUuid ?? null,
          now,
          now,
        );

      const insertItem = this.db.prepare(
        `INSERT INTO sale_item
           (id, sale_id, product_id, product_name, sku, server_variant_id,
            hsn_code, quantity, mrp_paise, unit_price_paise, discount_pct_bp,
            discount_paise, tax_rate_bp, tax_paise, line_total_paise, line_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.items.forEach((item, idx) => {
        insertItem.run(
          randomUUID(),
          saleId,
          item.productId ?? null,
          item.productName,
          item.sku ?? null,
          item.serverVariantId ?? null,
          item.hsnCode ?? null,
          item.quantity,
          item.mrpPaise ?? 0,
          item.unitPricePaise,
          item.discountPctBp ?? 0,
          item.discountPaise ?? 0,
          item.taxRateBp ?? 0,
          item.taxPaise ?? 0,
          item.lineTotalPaise,
          idx + 1,
        );
      });

      const insertPayment = this.db.prepare(
        `INSERT INTO payment (id, sale_id, method, amount_paise, reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const p of input.payments ?? []) {
        insertPayment.run(
          randomUUID(),
          saleId,
          p.method,
          p.amountPaise,
          p.reference ?? null,
          now,
        );
      }

      // Same transaction: a sale that exists locally but was never queued
      // would silently never reach the server.
      this.sync.enqueue({
        entityType: 'sale',
        entityId: saleId,
        operation: 'CREATE',
        payload: { saleId },
      });
    });

    run();

    // Line count and total are safe to log; item names and customer are not
    // needed for diagnostics and would be unnecessary personal data.
    log.info('sale.created_local', {
      sale_id: saleId,
      item_count: input.items.length,
      total_paise: input.totalPaise,
    });
    return saleId;
  }

  get(saleId: string): SaleRecord | null {
    const sale = this.db.prepare('SELECT * FROM sale WHERE id = ?').get(saleId) as
      | {
          id: string;
          server_id: string | null;
          invoice_number: string | null;
          local_reference: string | null;
          store_id: string | null;
          server_store_id: string | null;
          server_customer_id: string | null;
          server_salesperson_user_id: string | null;
          server_day_session_id: string | null;
          occurred_at: string | null;
          terminal_uuid: string | null;
          status: string;
          subtotal_paise: number;
          discount_paise: number;
          tax_paise: number;
          total_paise: number;
          bill_discount_paise: number | null;
          bill_discount_reason: string | null;
          coupon_code: string | null;
          redeem_points: number | null;
          round_off_paise: number | null;
          notes: string | null;
          created_at: string;
          sync_status: string;
        }
      | undefined;
    if (!sale) return null;

    const items = this.db
      .prepare(
        `SELECT id, product_name, sku, server_variant_id, hsn_code, quantity,
                mrp_paise, unit_price_paise, discount_pct_bp, discount_paise,
                tax_rate_bp, tax_paise, line_total_paise
           FROM sale_item WHERE sale_id = ? ORDER BY line_no`,
      )
      .all(saleId) as {
      id: string;
      product_name: string;
      sku: string | null;
      server_variant_id: string | null;
      hsn_code: string | null;
      quantity: number;
      mrp_paise: number;
      unit_price_paise: number;
      discount_pct_bp: number;
      discount_paise: number;
      tax_rate_bp: number;
      tax_paise: number;
      line_total_paise: number;
    }[];

    const payments = this.db
      .prepare('SELECT id, method, amount_paise, reference FROM payment WHERE sale_id = ?')
      .all(saleId) as {
      id: string;
      method: string;
      amount_paise: number;
      reference: string | null;
    }[];

    return {
      id: sale.id,
      serverId: sale.server_id,
      invoiceNumber: sale.invoice_number,
      localReference: sale.local_reference,
      storeId: sale.store_id,
      serverStoreId: sale.server_store_id,
      serverCustomerId: sale.server_customer_id,
      serverSalespersonUserId: sale.server_salesperson_user_id,
      serverDaySessionId: sale.server_day_session_id,
      occurredAt: sale.occurred_at,
      terminalUuid: sale.terminal_uuid,
      subtotalPaise: sale.subtotal_paise,
      discountPaise: sale.discount_paise,
      taxPaise: sale.tax_paise,
      // Coalesced rather than trusted: a bill written before migration 009
      // has no value in these columns, and a reprint of one must show no
      // adjustment — not a blank where a figure belongs.
      billDiscountPaise: sale.bill_discount_paise ?? 0,
      billDiscountReason: sale.bill_discount_reason,
      couponCode: sale.coupon_code,
      redeemPoints: sale.redeem_points ?? 0,
      roundOffPaise: sale.round_off_paise ?? 0,
      notes: sale.notes,
      status: sale.status,
      totalPaise: sale.total_paise,
      createdAt: sale.created_at,
      syncStatus: sale.sync_status,
      items: items.map((i) => ({
        id: i.id,
        productName: i.product_name,
        sku: i.sku,
        serverVariantId: i.server_variant_id,
        hsnCode: i.hsn_code,
        quantity: i.quantity,
        mrpPaise: i.mrp_paise,
        unitPricePaise: i.unit_price_paise,
        discountPctBp: i.discount_pct_bp,
        discountPaise: i.discount_paise,
        taxRateBp: i.tax_rate_bp,
        taxPaise: i.tax_paise,
        lineTotalPaise: i.line_total_paise,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amountPaise: p.amount_paise,
        reference: p.reference,
      })),
    };
  }

  /**
   * Record the server's identifiers after a successful sync.
   *
   * WHAT THIS DELIBERATELY DOES NOT TOUCH
   * ------------------------------------
   * `subtotal_paise`, `discount_paise`, `tax_paise`, `total_paise` and
   * `local_reference`. Those are the receipt the customer was handed. The
   * server's figures are written to SEPARATE columns so a divergence becomes
   * a visible fact rather than a silent rewrite of a document that has
   * already left the building.
   *
   * `local_reference` in particular is immutable: it is the offline bill's
   * identity, printed on paper, and the server's invoice number is an
   * additional identifier rather than a replacement for it.
   */
  markSynced(
    saleId: string,
    serverId: string,
    invoiceNumber?: string | null,
    serverTaxPaise?: number | null,
    serverTotalPaise?: number | null,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sale SET
           server_id = ?,
           invoice_number = COALESCE(?, invoice_number),
           server_tax_paise = ?,
           server_total_paise = ?,
           sync_status = 'SYNCED',
           synced_at = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        serverId,
        invoiceNumber ?? null,
        serverTaxPaise ?? null,
        serverTotalPaise ?? null,
        now,
        now,
        saleId,
      );
  }

  /**
   * Sales whose synced figures disagree with what was printed.
   *
   * The backend recomputes GST from the product's CURRENT tax_rate and
   * SaleLineInput has no tax field, so a rate change between the sale and the
   * sync produces two different numbers for one transaction. Neither side is
   * corrected automatically — that would be fabricating a financial record.
   * This surfaces the disagreement so a person can decide.
   */
  divergentSales(): {
    id: string;
    localReference: string | null;
    invoiceNumber: string | null;
    taxPaise: number;
    serverTaxPaise: number | null;
    totalPaise: number;
    serverTotalPaise: number | null;
  }[] {
    return this.db
      .prepare(
        `SELECT id, local_reference, invoice_number, tax_paise, server_tax_paise,
                total_paise, server_total_paise
           FROM sale
          WHERE server_tax_paise IS NOT NULL
            AND (server_tax_paise <> tax_paise OR server_total_paise <> total_paise)
          ORDER BY created_at ASC`,
      )
      .all()
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id as string,
          localReference: row.local_reference as string | null,
          invoiceNumber: row.invoice_number as string | null,
          taxPaise: row.tax_paise as number,
          serverTaxPaise: row.server_tax_paise as number | null,
          totalPaise: row.total_paise as number,
          serverTotalPaise: row.server_total_paise as number | null,
        };
      });
  }

  /**
   * Recent local sales with their synchronisation state, newest first.
   *
   * READ ONLY. This exists so a cashier can answer "did last night's bills
   * actually reach the server?" without opening a database tool. It computes
   * nothing: every financial figure is returned exactly as stored, and the
   * status is derived from the queue row rather than recalculated.
   *
   * The queue row is LEFT JOINed because the two can legitimately diverge —
   * a synced sale's queue entry is eventually pruned (see pruneSynced), and
   * the sale itself must still be listable long after that.
   */
  list(limit = 100): LocalSaleSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.local_reference, s.invoice_number, s.server_id,
                s.total_paise, s.created_at, s.occurred_at, s.sync_status,
                s.terminal_uuid, s.server_day_session_id, s.synced_at,
                q.status        AS queue_status,
                q.failure_kind  AS failure_kind,
                q.attempt_count AS attempt_count,
                q.next_attempt_at AS next_attempt_at,
                q.error         AS error
           FROM sale s
           LEFT JOIN sync_queue q
             ON q.entity_id = s.id AND q.entity_type = 'sale'
          ORDER BY s.created_at DESC
          LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as string,
      localReference: (r.local_reference as string | null) ?? null,
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      serverId: (r.server_id as string | null) ?? null,
      totalPaise: r.total_paise as number,
      createdAt: r.created_at as string,
      occurredAt: (r.occurred_at as string | null) ?? null,
      syncedAt: (r.synced_at as string | null) ?? null,
      terminalUuid: (r.terminal_uuid as string | null) ?? null,
      serverDaySessionId: (r.server_day_session_id as string | null) ?? null,
      attemptCount: (r.attempt_count as number | null) ?? 0,
      nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      state: deriveSyncState({
        serverId: (r.server_id as string | null) ?? null,
        saleSyncStatus: r.sync_status as string,
        queueStatus: (r.queue_status as string | null) ?? null,
        failureKind: (r.failure_kind as string | null) ?? null,
      }),
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number };
    return row.n;
  }
}
