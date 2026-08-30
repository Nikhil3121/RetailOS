/**
 * Offline sale synchronisation worker.
 *
 * SQLite -> claim -> rebuild SaleCreate -> validate -> POST -> record outcome
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * Not a general sync engine. It pushes locally committed SALES and nothing
 * else: no inventory, no products, no pull, no bidirectional reconciliation.
 * It also does not touch the online billing path — a bill rung up while the
 * connection is healthy still goes straight to the API exactly as it always
 * has. This drains the backlog that offline billing creates.
 *
 * ── WHY IT CANNOT BLOCK THE COUNTER ────────────────────────────────────────
 * Checkout writes to SQLite and returns. It never waits for this. If the
 * worker is running, stuck, or has never run at all, billing is unaffected —
 * the queue is durable and the cashier is not.
 *
 * ── THE IDEMPOTENCY GUARANTEE ──────────────────────────────────────────────
 * `client_uuid` is `sale.id`, generated once at checkout and reused verbatim
 * on every retry forever. This worker NEVER generates a UUID. That is what
 * makes the dangerous case safe:
 *
 *     POST arrives -> server commits -> response lost -> we retry
 *     -> same client_uuid -> server returns the EXISTING sale
 *
 * Verified in backend/app/services/sale.py: the create path checks
 * `client_uuid` before inserting and returns the existing row, backed by
 * UniqueConstraint("client_uuid", name="uq_sales_client_uuid").
 */

import { databaseService } from '../database/database-service';
import { describeError, log } from '../database/logger';
import type { SyncQueueRow } from '../database/repositories/sync-repository';
import { getPosConfig } from '../pos-config';
import { classifyHttpFailure, classifyTransportError } from './error-classifier';
import { decimalStringToPaise } from './money';
import { buildSaleCreatePayload, describePayload, type SaleCreatePayload } from './payload-builder';
import { resolveSyncTarget } from './sync-target';

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_BATCH = 25;

export interface SyncRunResult {
  ok: boolean;
  attempted: number;
  synced: number;
  retryable: number;
  permanent: number;
  blocked: number;
  divergent: number;
  durationMs: number;
  error?: string;
}

export interface DryRunLine {
  queueId: string;
  saleId: string;
  localReference: string | null;
  buildable: boolean;
  reason?: string;
  shape?: Record<string, unknown>;
}

export interface DryRunResult {
  ok: boolean;
  total: number;
  buildable: number;
  unbuildable: number;
  lines: DryRunLine[];
}

interface PostOutcome {
  ok: boolean;
  status: number;
  body: unknown;
}

class SaleSyncService {
  /**
   * In-process guard against two overlapping runs.
   *
   * The database claim is the real protection (see SyncRepository.claimBatch,
   * where the SELECT and the guarded UPDATE share one transaction). This flag
   * simply stops a second run from starting and doing useless work — a
   * periodic timer firing while a slow run is still going.
   */
  private running = false;

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Rebuild every pending sale's payload and validate it WITHOUT sending
   * anything.
   *
   * This calls the exact same builder the real push uses, so a clean dry-run
   * is genuine evidence that the backlog can be converted into valid API
   * requests. A dry-run that exercised a separate code path would prove only
   * that the separate code path works.
   */
  dryRun(limit = DEFAULT_BATCH): DryRunResult {
    const sync = databaseService.syncs();
    const sales = databaseService.sales();

    // Read-only: rows are inspected, never claimed. A dry run must leave the
    // queue exactly as it found it.
    const rows = sync.pendingSaleRows(limit);
    const lines: DryRunLine[] = [];

    for (const row of rows) {
      const saleId = this.saleIdOf(row);
      const sale = saleId ? sales.get(saleId) : null;

      if (!sale) {
        lines.push({
          queueId: row.id,
          saleId: saleId ?? '(unreadable payload)',
          localReference: null,
          buildable: false,
          reason: 'Queue entry does not resolve to a stored sale.',
        });
        continue;
      }

      const built = buildSaleCreatePayload(sale);
      lines.push({
        queueId: row.id,
        saleId: sale.id,
        localReference: sale.localReference,
        buildable: built.ok,
        ...(built.ok
          ? { shape: describePayload(built.payload) }
          : { reason: built.reason }),
      });
    }

    const buildable = lines.filter((l) => l.buildable).length;
    log.info('sync.dry_run', {
      total: lines.length,
      buildable,
      unbuildable: lines.length - buildable,
    });

    return { ok: true, total: lines.length, buildable, unbuildable: lines.length - buildable, lines };
  }

  /** Drain due sale entries. Safe to call repeatedly; safe to call offline. */
  async run(options: {
    accessToken: string;
    /** Where the renderer authenticated. The token is only valid there. */
    apiBaseUrl?: string | null;
    limit?: number;
  }): Promise<SyncRunResult> {
    const started = Date.now();
    const empty: SyncRunResult = {
      ok: true,
      attempted: 0,
      synced: 0,
      retryable: 0,
      permanent: 0,
      blocked: 0,
      divergent: 0,
      durationMs: 0,
    };

    if (this.running) {
      return { ...empty, ok: false, error: 'A synchronisation run is already in progress.' };
    }

    // Decide the destination BEFORE claiming anything. A refusal here must not
    // leave queue rows stuck in PROCESSING for a run that never happened.
    // RETAILOS_API_BASE_URL is an OPERATOR OVERRIDE and only counts when it is
    // explicitly set. getPosConfig() always returns something (it defaults to
    // localhost), so treating that default as a deliberate choice would make it
    // conflict with every remote renderer URL and refuse every run. It is
    // therefore used only when the caller supplied no origin of its own.
    const override = process.env.RETAILOS_API_BASE_URL?.trim() || null;
    const target = resolveSyncTarget(
      options.apiBaseUrl,
      override ?? (options.apiBaseUrl ? null : getPosConfig().apiBaseUrl),
    );
    if (!target.ok) {
      log.error('sync.target_rejected', { error_message: target.error });
      return { ...empty, ok: false, error: target.error };
    }

    this.running = true;

    const sync = databaseService.syncs();
    const sales = databaseService.sales();
    const result = { ...empty };

    try {
      // Anything stranded in PROCESSING by a crash comes back first —
      // otherwise those rows would never be eligible again.
      sync.recoverStale();

      const claimed = sync.claimBatch(options.limit ?? DEFAULT_BATCH, 'sale');
      result.attempted = claimed.length;

      for (const row of claimed) {
        const outcome = await this.processOne(row, options.accessToken, target.url, sync, sales);
        switch (outcome) {
          case 'SYNCED':
            result.synced += 1;
            break;
          case 'DIVERGENT':
            result.synced += 1;
            result.divergent += 1;
            break;
          case 'BLOCKED':
            result.blocked += 1;
            break;
          case 'PERMANENT':
            result.permanent += 1;
            break;
          default:
            result.retryable += 1;
        }
      }

      sync.upsertState({
        entity: 'sale_push',
        lastSuccessfulSync: result.synced > 0 ? new Date().toISOString() : null,
        syncStatus: 'IDLE',
      });
    } catch (err) {
      log.error('sync.run_failed', describeError(err));
      result.ok = false;
      result.error = 'Synchronisation run failed.';
    } finally {
      this.running = false;
    }

    result.durationMs = Date.now() - started;
    log.info('sync.run_complete', {
      attempted: result.attempted,
      synced: result.synced,
      retryable: result.retryable,
      permanent: result.permanent,
      blocked: result.blocked,
      divergent: result.divergent,
      duration_ms: result.durationMs,
    });
    return result;
  }

  // ------------------------------------------------------------------

  private saleIdOf(row: SyncQueueRow): string | null {
    try {
      const parsed = JSON.parse(row.payload) as { saleId?: unknown };
      return typeof parsed.saleId === 'string' ? parsed.saleId : null;
    } catch {
      // The queue payload is a pointer to the sale; the sale itself is the
      // record of truth. entity_id holds the same id, so a corrupted payload
      // blob is recoverable rather than fatal.
      return row.entity_id || null;
    }
  }

  private async processOne(
    row: SyncQueueRow,
    accessToken: string,
    apiBaseUrl: string,
    sync: ReturnType<typeof databaseService.syncs>,
    sales: ReturnType<typeof databaseService.sales>,
  ): Promise<'SYNCED' | 'DIVERGENT' | 'BLOCKED' | 'PERMANENT' | 'RETRYABLE'> {
    const saleId = this.saleIdOf(row);
    const sale = saleId ? sales.get(saleId) : null;

    // A queue entry with no sale behind it can never succeed. It is recorded
    // as permanently failed and KEPT, not deleted — an unexplained queue row
    // is evidence, and deleting it destroys the only trace.
    if (!sale) {
      sync.markPermanentlyFailed(row.id, 'SALE_MISSING', 'No stored sale for this queue entry.');
      return 'PERMANENT';
    }

    // Already synced on an earlier run whose bookkeeping did not complete —
    // for example the process died between the server's 201 and our UPDATE.
    // Re-POSTing would be harmless thanks to idempotency, but there is no
    // reason to.
    if (sale.serverId) {
      sync.markSynced(row.id);
      return 'SYNCED';
    }

    const built = buildSaleCreatePayload(sale);
    if (!built.ok) {
      // Missing variant id, missing store, empty bill. None of these change
      // by waiting, so this stops rather than retrying forever.
      sync.markPermanentlyFailed(row.id, 'PAYLOAD_INVALID', built.reason);
      return 'PERMANENT';
    }

    // The attribution that goes on the wire must be byte-identical to what
    // was committed at the counter. This is asserted rather than assumed: a
    // future edit that "helpfully" resolved the current session here would
    // silently reintroduce the wrong-shift defect, and a comment would not
    // stop it.
    if (
      built.payload.day_session_id !== (sale.serverDaySessionId ?? null) ||
      built.payload.occurred_at !== (sale.occurredAt ?? null) ||
      built.payload.terminal_uuid !== (sale.terminalUuid ?? null)
    ) {
      sync.markPermanentlyFailed(
        row.id,
        'ATTRIBUTION_MUTATED',
        'Payload attribution does not match the committed sale.',
      );
      return 'PERMANENT';
    }

    let response: PostOutcome;
    try {
      response = await this.post(built.payload, accessToken, apiBaseUrl);
    } catch (err) {
      // The request never got a verdict. The server MAY have committed the
      // sale — the retry carries the same client_uuid, so a replay collapses
      // onto the existing row instead of creating a second one.
      const classified = classifyTransportError(err);
      sync.markFailed(row.id, `${classified.code}: ${classified.message}`);
      return 'RETRYABLE';
    }

    if (!response.ok) {
      const classified = classifyHttpFailure(response.status, response.body);
      if (classified.kind === 'BLOCKED') {
        // Valid sale, server not ready — almost always NO_OPEN_DAY_SESSION.
        // Stays pending, does not burn attempts, retried on a long interval.
        // The sale remains durable and printable throughout.
        sync.markBlocked(row.id, classified.code, classified.message);
        return 'BLOCKED';
      }
      if (classified.kind === 'PERMANENT') {
        sync.markPermanentlyFailed(row.id, classified.code, classified.message);
        return 'PERMANENT';
      }
      sync.markFailed(row.id, `${classified.code}: ${classified.message}`);
      return 'RETRYABLE';
    }

    return this.recordSuccess(
      row,
      sale.id,
      sale.taxPaise,
      sale.totalPaise,
      response.body,
      sync,
      sales,
    );
  }

  /**
   * Record the server's identity for a sale, and compare its money to ours.
   *
   * The comparison is the entire answer to the tax problem. The backend
   * recomputes GST from the product's current tax_rate and SaleLineInput has
   * no tax field, so an offline bill synced after a rate change can come back
   * with a different tax figure than the paper receipt.
   *
   * Local values are NOT corrected. Rewriting them would falsify a document
   * already in a customer's hand; adopting the server's number silently would
   * hide that two records of one transaction disagree. The server's figures
   * are stored alongside, and the divergence is logged and counted so a human
   * can reconcile it deliberately.
   */
  private recordSuccess(
    row: SyncQueueRow,
    saleId: string,
    localTaxPaise: number,
    localTotalPaise: number,
    body: unknown,
    sync: ReturnType<typeof databaseService.syncs>,
    sales: ReturnType<typeof databaseService.sales>,
  ): 'SYNCED' | 'DIVERGENT' | 'RETRYABLE' {
    const payload = (body ?? {}) as Record<string, unknown>;
    const serverId = typeof payload.id === 'string' ? payload.id : null;

    // A 2xx with no id is not a success we can record. Treated as retryable:
    // the sale may well have been created, and the same client_uuid makes a
    // retry safe and self-correcting.
    if (!serverId) {
      sync.markFailed(row.id, 'NO_SERVER_ID: success response carried no sale id.');
      return 'RETRYABLE';
    }

    // SaleRead.number is the server-allocated GST invoice number. It is
    // stored ALONGSIDE local_reference, never over it — the offline reference
    // is printed on paper and is immutable.
    const invoiceNumber = typeof payload.number === 'string' ? payload.number : null;
    const serverTaxPaise = decimalStringToPaise(payload.tax_total as string | number | undefined);
    const serverTotalPaise = decimalStringToPaise(
      payload.grand_total as string | number | undefined,
    );

    sales.markSynced(saleId, serverId, invoiceNumber, serverTaxPaise, serverTotalPaise);
    sync.markSynced(row.id);

    const taxDiverged = serverTaxPaise !== null && serverTaxPaise !== localTaxPaise;
    // The GRAND TOTAL can diverge independently of tax, and it matters more.
    // SaleLineInput has no field for the charged line total: the backend
    // derives it from unit_price x quantity x (1 - discount_pct/100). When a
    // shelf price is a ROUNDED figure — the shop's label reads MRP 343, 30%
    // off, price 240, but 343 less 30% is 240.10 — the server reconstructs a
    // total that is not the money the customer handed over.
    const totalDiverged = serverTotalPaise !== null && serverTotalPaise !== localTotalPaise;

    if (taxDiverged || totalDiverged) {
      log.warn('sync.money_divergence', {
        sale_id: saleId,
        tax_diverged: taxDiverged,
        total_diverged: totalDiverged,
        local_tax_paise: localTaxPaise,
        server_tax_paise: serverTaxPaise,
        local_total_paise: localTotalPaise,
        server_total_paise: serverTotalPaise,
      });
      return 'DIVERGENT';
    }

    return 'SYNCED';
  }

  private async post(
    payload: SaleCreatePayload,
    accessToken: string,
    apiBaseUrl: string,
  ): Promise<PostOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/sales`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // A proxy or gateway can return HTML on an error. Parsing must not
      // throw, or a 502 would be misreported as a transport failure.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const saleSyncService = new SaleSyncService();
