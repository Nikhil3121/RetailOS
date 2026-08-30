/**
 * Read-only view of locally committed sales and their sync state.
 *
 * Mirrors catalog-service.ts: the renderer talks to a named IPC operation,
 * never to SQLite. Nothing here writes, retries or recomputes — it reports
 * what the database already holds, so the screens built on it cannot drift
 * from the money that was actually stored.
 *
 * Every call degrades to an empty result outside Electron (browser dev) and on
 * error. A reporting view that throws would take the page down; one that shows
 * nothing is merely unhelpful, and the distinction matters on a shop counter.
 */

/** The six states a cashier can act on. Mirrors LocalSyncState in the main process. */
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

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** True when the Electron bridge is present. */
export function isLocalSalesAvailable(): boolean {
  return typeof window !== 'undefined' && window.retailos?.db !== undefined;
}

export async function listLocalSales(limit = 100): Promise<LocalSaleSummary[]> {
  const bridge = typeof window !== 'undefined' ? window.retailos?.db : undefined;
  if (!bridge?.listSales) return [];
  try {
    const res = (await bridge.listSales(limit)) as Envelope<LocalSaleSummary[]>;
    return res.ok ? res.data : [];
  } catch {
    return [];
  }
}

export interface LocalSyncSnapshot {
  queue: Record<string, number>;
  failures: Record<string, number>;
  running: boolean;
  /** Sales whose server-computed money disagrees with the printed receipt. */
  divergent: unknown[];
}

export async function getSyncSnapshot(): Promise<LocalSyncSnapshot | null> {
  const bridge = typeof window !== 'undefined' ? window.retailos?.sync : undefined;
  if (!bridge) return null;
  try {
    const res = (await bridge.getStatus()) as Envelope<LocalSyncSnapshot>;
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}

/** Integer paise to a display string. Never divides — see electron/sync/money.ts. */
export function paiseToDisplay(paise: number): string {
  const negative = paise < 0;
  const digits = String(Math.abs(paise)).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** How many sales still need to reach the server. */
export function unsyncedCount(sales: LocalSaleSummary[]): number {
  return sales.filter((s) => s.state !== 'SYNCED').length;
}

/** Sales a person must look at — blocked resolves itself, failed does not. */
export function needsAttention(sales: LocalSaleSummary[]): LocalSaleSummary[] {
  return sales.filter((s) => s.state === 'FAILED');
}
