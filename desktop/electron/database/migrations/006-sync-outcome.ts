/**
 * Migration 006 — make every synchronisation outcome recordable.
 *
 * WHY failure_kind
 * ----------------
 * The queue already has a `status`, but its CHECK constraint allows only
 * PENDING / PROCESSING / FAILED / SYNCED. That cannot express the difference
 * between three failures that need completely different handling:
 *
 *   RETRYABLE  network died, 5xx, timeout        → back off and try again
 *   PERMANENT  VARIANT_NOT_FOUND, 422            → stop; a human must look
 *   BLOCKED    NO_OPEN_DAY_SESSION               → valid sale, server not ready
 *
 * Treating all three the same is how a shop either hammers a doomed request
 * forever or silently abandons a real bill. `failure_kind` subdivides FAILED
 * and PENDING without rebuilding the table, so the existing CHECK constraint
 * and every row already in it stay exactly as they are.
 *
 * BLOCKED specifically does NOT count toward retry exhaustion. An overnight
 * offline bill waiting for someone to open a day session is not failing — it
 * is waiting. Letting it burn attempts would eventually mark a perfectly good
 * sale as permanently dead.
 *
 * WHY server_tax_paise / server_total_paise
 * -----------------------------------------
 * The backend recomputes GST from the product's CURRENT tax_rate, and
 * SaleLineInput has no tax field, so the server can legitimately arrive at a
 * different figure than the receipt already handed to the customer.
 *
 * These columns record WHAT THE SERVER SAID, next to — never over — what was
 * printed. The local values remain the authoritative receipt. A divergence
 * becomes a visible, queryable fact instead of a silent rewrite of financial
 * history:
 *
 *     SELECT ... FROM sale WHERE server_tax_paise IS NOT NULL
 *                            AND server_tax_paise <> tax_paise;
 *
 * Nothing is derived into a stored column — a "divergence" column could drift
 * out of step with the two values it summarises.
 */

import type { Migration } from './types';

export const migration006: Migration = {
  version: 6,
  name: 'sync-outcome',
  up: (db) => {
    db.exec(`
      -- RETRYABLE | PERMANENT | BLOCKED. Null while a row has never failed.
      ALTER TABLE sync_queue ADD COLUMN failure_kind TEXT;

      -- The worker polls "PENDING and due" on every pass; without this it is
      -- a full table scan once the queue has any history in it.
      CREATE INDEX idx_sync_queue_due ON sync_queue(status, next_attempt_at);

      -- Reconciliation: local sale -> server sale, and WHEN it got there.
      -- server_id and invoice_number already exist on sale (migration 001).
      ALTER TABLE sale ADD COLUMN synced_at TEXT;

      -- Observation only. Never used to overwrite tax_paise/total_paise.
      ALTER TABLE sale ADD COLUMN server_tax_paise   INTEGER;
      ALTER TABLE sale ADD COLUMN server_total_paise INTEGER;
    `);
  },
};
