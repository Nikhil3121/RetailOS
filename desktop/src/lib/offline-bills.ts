/**
 * Offline bill queue.
 *
 * When the network is up, Billing POSTs `/sales` directly. When it's down (or
 * the request fails with a network error), the bill is stashed in localStorage
 * with a client-generated UUID. Any later successful sync replays the queue
 * in order — the backend uses the UUID as an idempotency key so replay never
 * creates duplicates, even if a bill actually made it through on the failed
 * attempt.
 */

import { createSale, type Sale, type SaleCreate } from '@/lib/sales-api';

const STORAGE_KEY = 'retailos.offline_bills.v1';

export interface QueuedBill {
  client_uuid: string;
  body: SaleCreate;
  queued_at: string;
  attempts: number;
  last_error: string | null;
}

export type QueueListener = (bills: QueuedBill[]) => void;

const listeners = new Set<QueueListener>();

function readQueue(): QueuedBill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(next: QueuedBill[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    for (const cb of listeners) cb(next);
  } catch {
    /* quota exhausted or private mode — nothing to do */
  }
}

export function getQueuedBills(): QueuedBill[] {
  return readQueue();
}

export function subscribeQueue(cb: QueueListener): () => void {
  listeners.add(cb);
  // Fire once so the caller gets an initial value.
  cb(readQueue());
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Generate a stable idempotency key. Uses crypto.randomUUID when the runtime
 * has it (all modern browsers + Electron), falls back to a Math.random-based
 * v4 so unit tests / old runtimes still work.
 */
export function newClientUuid(): string {
  const g: unknown = globalThis;
  const c = (g as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function enqueueBill(body: SaleCreate): QueuedBill {
  const client_uuid = body.client_uuid ?? newClientUuid();
  const stamped: SaleCreate = { ...body, client_uuid };
  const entry: QueuedBill = {
    client_uuid,
    body: stamped,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  };
  const next = [...readQueue(), entry];
  writeQueue(next);
  return entry;
}

export function removeFromQueue(clientUuid: string): void {
  writeQueue(readQueue().filter((b) => b.client_uuid !== clientUuid));
}

function updateEntry(clientUuid: string, patch: Partial<QueuedBill>): void {
  writeQueue(
    readQueue().map((b) =>
      b.client_uuid === clientUuid ? { ...b, ...patch } : b,
    ),
  );
}

/**
 * Drain the queue: for every pending bill, POST /sales. On success the entry
 * is removed. Idempotency on the backend means a duplicate POST just returns
 * the existing sale — safe. Returns per-bill results so the caller can
 * surface a summary.
 */
export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  sales: Sale[];
  errors: string[];
}

let syncingLock = false;

export async function syncQueue(): Promise<SyncResult> {
  if (syncingLock) {
    return { attempted: 0, succeeded: 0, failed: 0, sales: [], errors: [] };
  }
  syncingLock = true;
  const result: SyncResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    sales: [],
    errors: [],
  };
  try {
    // Snapshot the queue at start — new bills queued mid-sync are handled next tick.
    const pending = readQueue();
    for (const entry of pending) {
      result.attempted += 1;
      try {
        const sale = await createSale(entry.body);
        removeFromQueue(entry.client_uuid);
        result.succeeded += 1;
        result.sales.push(sale);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateEntry(entry.client_uuid, {
          attempts: entry.attempts + 1,
          last_error: msg,
        });
        result.failed += 1;
        result.errors.push(msg);
      }
    }
  } finally {
    syncingLock = false;
  }
  return result;
}

/**
 * Install listeners so bills auto-sync when the browser flips to online.
 * Returns an unsubscribe function.
 */
export function installAutoSync(): () => void {
  const handler = (): void => {
    void syncQueue();
  };
  window.addEventListener('online', handler);
  // Kick once on install in case we're already online with a stale queue.
  void syncQueue();
  return () => {
    window.removeEventListener('online', handler);
  };
}
