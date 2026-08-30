/**
 * Sync queue and sync state.
 *
 * This is INFRASTRUCTURE ONLY for this phase — rows can be enqueued, claimed,
 * completed and failed, and the backoff schedule is computed. Nothing here
 * talks to the network. The actual transport lands in a later phase.
 *
 * The queue is deliberately generic over `entity_type` so purchases, customers
 * and stock movements can use the same machinery later without a schema change.
 */

import { randomUUID } from 'node:crypto';

import type { Db } from '../connection';
import { log } from '../logger';

export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';
export type SyncStatus = 'PENDING' | 'PROCESSING' | 'FAILED' | 'SYNCED';

export interface SyncQueueRow {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  payload: string;
  created_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  status: SyncStatus;
  error: string | null;
}

/** Retry schedule in seconds. Capped so a permanently-broken row still gets
 *  retried roughly hourly rather than drifting to never. */
const BACKOFF_SECONDS = [5, 30, 120, 600, 1800, 3600];

export function backoffFor(attemptCount: number): number {
  const idx = Math.min(attemptCount, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx];
}

/**
 * Backoff with up to 20% downward jitter.
 *
 * Fifteen terminals that lose the same broadband line reconnect at the same
 * instant and would otherwise retry in lockstep forever, hitting the server
 * in synchronised waves. Jitter spreads them out.
 *
 * It only ever subtracts, so the delay stays within the bounded schedule and
 * a test asserting "at most the nominal backoff" cannot flake.
 */
export function backoffWithJitter(attemptCount: number, random = Math.random): number {
  const base = backoffFor(attemptCount);
  return Math.max(1, Math.round(base * (1 - random() * 0.2)));
}

export class SyncRepository {
  constructor(private readonly db: Db) {}

  /** Add work to the queue. Returns the queue row id (not the entity id). */
  enqueue(input: {
    entityType: string;
    entityId: string;
    operation: SyncOperation;
    payload: unknown;
  }): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sync_queue
           (id, entity_type, entity_id, operation, payload,
            created_at, attempt_count, next_attempt_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'PENDING')`,
      )
      .run(
        id,
        input.entityType,
        input.entityId,
        input.operation,
        JSON.stringify(input.payload),
        now,
        now, // due immediately
      );

    log.info('sync.enqueued', {
      queue_id: id,
      entity_type: input.entityType,
      operation: input.operation,
    });
    return id;
  }

  /**
   * Rows that are PENDING and due now, oldest first.
   *
   * Ordering by `created_at` preserves the sequence in which the shop actually
   * did things — replaying a customer update before the customer's creation
   * would fail on the server.
   */
  claimBatch(limit = 25, entityType?: string): SyncQueueRow[] {
    const now = new Date().toISOString();

    // The SELECT and the UPDATE run inside ONE transaction. Previously the
    // read happened outside it, which left a window where a second worker
    // could read the same PENDING rows before the first marked them
    // PROCESSING — and both would then POST the same sale. The server's
    // idempotency would have caught the duplicate, but relying on the server
    // to clean up a race we created locally is not a design.
    const claim = this.db.transaction((): SyncQueueRow[] => {
      const rows = (
        entityType
          ? this.db
              .prepare(
                `SELECT * FROM sync_queue
                  WHERE status = 'PENDING' AND entity_type = ?
                    AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                  ORDER BY created_at ASC
                  LIMIT ?`,
              )
              .all(entityType, now, limit)
          : this.db
              .prepare(
                `SELECT * FROM sync_queue
                  WHERE status = 'PENDING'
                    AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                  ORDER BY created_at ASC
                  LIMIT ?`,
              )
              .all(now, limit)
      ) as SyncQueueRow[];

      const mark = this.db.prepare(
        `UPDATE sync_queue SET status = 'PROCESSING', last_attempt_at = ?
          WHERE id = ? AND status = 'PENDING'`,
      );

      const claimed: SyncQueueRow[] = [];
      for (const r of rows) {
        // The guarded UPDATE is the actual claim. If another writer moved the
        // row first, `changes` is 0 and we simply do not own it.
        if (mark.run(now, r.id).changes === 1) {
          claimed.push({ ...r, status: 'PROCESSING' as SyncStatus, last_attempt_at: now });
        }
      }
      return claimed;
    });

    return claim();
  }

  /**
   * Return rows stranded in PROCESSING to PENDING.
   *
   * A row is stranded when the process died between claiming it and recording
   * an outcome — a power cut mid-request, which on a shop counter is a
   * Tuesday. Without this the entry would sit in PROCESSING forever and the
   * sale would never reach the server, which is exactly the silent loss this
   * phase must prevent.
   *
   * Recovery is SAFE even if the request actually reached the server, because
   * the replay carries the same client_uuid and the server collapses it onto
   * the existing sale rather than creating a second one.
   *
   * `attempt_count` is deliberately NOT incremented: a crash is not the
   * bill's fault, and charging it a retry could eventually exhaust a sale
   * that never actually failed.
   */
  recoverStale(olderThanMs = 5 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const res = this.db
      .prepare(
        `UPDATE sync_queue
            SET status = 'PENDING', next_attempt_at = ?
          WHERE status = 'PROCESSING'
            AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
      )
      .run(new Date().toISOString(), cutoff);

    if (res.changes > 0) {
      log.warn('sync.stale_recovered', { recovered_count: res.changes });
    }
    return res.changes;
  }

  /** One queue row by id. */
  get(queueId: string): SyncQueueRow | null {
    return (
      (this.db.prepare('SELECT * FROM sync_queue WHERE id = ?').get(queueId) as
        | SyncQueueRow
        | undefined) ?? null
    );
  }

  /**
   * A valid sale the server is not ready to accept yet — practically always
   * NO_OPEN_DAY_SESSION.
   *
   * Stays PENDING and does NOT increment attempt_count, so it can never
   * exhaust its way into FAILED. The bill is fine; the till is closed. It
   * waits on a long, fixed interval rather than the failure backoff, because
   * this resolves when a human opens a session, not on a timer.
   */
  markBlocked(queueId: string, code: string, message: string, retryInMs = 15 * 60 * 1000): void {
    this.db
      .prepare(
        `UPDATE sync_queue SET
           status = 'PENDING', failure_kind = 'BLOCKED',
           last_attempt_at = ?, next_attempt_at = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        new Date().toISOString(),
        new Date(Date.now() + retryInMs).toISOString(),
        `${code}: ${message}`.slice(0, 500),
        queueId,
      );

    log.warn('sync.item_blocked', { queue_id: queueId, code });
  }

  /**
   * The server understood the request and rejected it on its merits.
   *
   * Goes straight to FAILED with no further attempts — retrying identical
   * bytes gets an identical rejection. The row is KEPT, never deleted: it is
   * a real bill that a person now has to look at.
   */
  markPermanentlyFailed(queueId: string, code: string, message: string): void {
    this.db
      .prepare(
        `UPDATE sync_queue SET
           status = 'FAILED', failure_kind = 'PERMANENT',
           attempt_count = attempt_count + 1,
           last_attempt_at = ?, next_attempt_at = NULL, error = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), `${code}: ${message}`.slice(0, 500), queueId);

    log.error('sync.item_permanent_failure', { queue_id: queueId, code });
  }

  markSynced(queueId: string): void {
    // failure_kind is cleared too — a row that succeeded on its fourth try is
    // not a failed row, and leaving the stale kind behind would make the
    // monitoring view lie.
    this.db
      .prepare(
        `UPDATE sync_queue SET status = 'SYNCED', error = NULL, failure_kind = NULL
          WHERE id = ?`,
      )
      .run(queueId);
    log.info('sync.item_synced', { queue_id: queueId });
  }

  /**
   * Record a failure and schedule the next attempt.
   *
   * The row goes back to PENDING rather than FAILED — FAILED is reserved for
   * work that has exhausted its retries and needs a human. Distinguishing them
   * is what lets a monitoring view show "stuck" separately from "retrying".
   */
  markFailed(queueId: string, error: string, maxAttempts = 8): void {
    const row = this.db
      .prepare('SELECT attempt_count FROM sync_queue WHERE id = ?')
      .get(queueId) as { attempt_count: number } | undefined;
    if (!row) return;

    const attempts = row.attempt_count + 1;
    const exhausted = attempts >= maxAttempts;
    const nextAt = new Date(Date.now() + backoffWithJitter(attempts) * 1000).toISOString();

    this.db
      .prepare(
        `UPDATE sync_queue SET
           status = ?, failure_kind = 'RETRYABLE', attempt_count = ?,
           last_attempt_at = ?, next_attempt_at = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        exhausted ? 'FAILED' : 'PENDING',
        attempts,
        new Date().toISOString(),
        exhausted ? null : nextAt,
        // Truncated — a long server stack trace in every row would bloat the
        // database and tells us nothing the first 500 characters do not.
        error.slice(0, 500),
        queueId,
      );

    log.warn('sync.item_failed', {
      queue_id: queueId,
      attempt_count: attempts,
      exhausted,
    });
  }

  /**
   * Pending sale rows, oldest first, WITHOUT claiming them.
   *
   * Read-only by design — the dry run must be able to inspect the backlog
   * without changing a single row's status.
   */
  pendingSaleRows(limit = 25): SyncQueueRow[] {
    return this.db
      .prepare(
        `SELECT * FROM sync_queue
          WHERE entity_type = 'sale' AND status IN ('PENDING','PROCESSING')
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .all(limit) as SyncQueueRow[];
  }

  /** Counts broken down by failure kind, for the operator-facing view. */
  failureKindCounts(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT failure_kind AS k, COUNT(*) AS n FROM sync_queue
          WHERE failure_kind IS NOT NULL GROUP BY failure_kind`,
      )
      .all() as { k: string; n: number }[];
    const out: Record<string, number> = { RETRYABLE: 0, PERMANENT: 0, BLOCKED: 0 };
    for (const r of rows) out[r.k] = r.n;
    return out;
  }

  counts(): Record<SyncStatus, number> {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM sync_queue GROUP BY status')
      .all() as { status: SyncStatus; n: number }[];
    const out: Record<SyncStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      FAILED: 0,
      SYNCED: 0,
    };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /** Remove SYNCED rows older than `days`, keeping the queue table small. */
  pruneSynced(days = 7): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const res = this.db
      .prepare(`DELETE FROM sync_queue WHERE status = 'SYNCED' AND created_at < ?`)
      .run(cutoff);
    return res.changes;
  }

  // ---- sync_state ----

  getState(entity: string): {
    entity: string;
    lastServerCursor: string | null;
    lastSuccessfulSync: string | null;
    syncStatus: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM sync_state WHERE entity = ?').get(entity) as
      | {
          entity: string;
          last_server_cursor: string | null;
          last_successful_sync: string | null;
          sync_status: string;
        }
      | undefined;
    if (!row) return null;
    return {
      entity: row.entity,
      lastServerCursor: row.last_server_cursor,
      lastSuccessfulSync: row.last_successful_sync,
      syncStatus: row.sync_status,
    };
  }

  upsertState(input: {
    entity: string;
    lastServerCursor?: string | null;
    lastSuccessfulSync?: string | null;
    syncStatus?: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sync_state
           (entity, last_server_cursor, last_successful_sync, sync_status, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entity) DO UPDATE SET
           last_server_cursor   = COALESCE(excluded.last_server_cursor, sync_state.last_server_cursor),
           last_successful_sync = COALESCE(excluded.last_successful_sync, sync_state.last_successful_sync),
           sync_status          = excluded.sync_status,
           updated_at           = excluded.updated_at`,
      )
      .run(
        input.entity,
        input.lastServerCursor ?? null,
        input.lastSuccessfulSync ?? null,
        input.syncStatus ?? 'IDLE',
        now,
      );
  }

  allStates(): ReturnType<SyncRepository['getState']>[] {
    const rows = this.db.prepare('SELECT entity FROM sync_state').all() as { entity: string }[];
    return rows.map((r) => this.getState(r.entity));
  }
}
