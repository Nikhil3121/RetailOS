/**
 * When to ASK the sync worker to run.
 *
 * ── SCOPE, DELIBERATELY NARROW ─────────────────────────────────────────────
 * This module decides *timing only*. It never decides what happens to a sale.
 * Retry backoff per bill, BLOCKED vs PERMANENT, idempotency and attribution
 * all live in the worker (electron/sync/sale-sync-service.ts) and are already
 * verified against real PostgreSQL. Duplicating any of that here would create
 * a second opinion about money, and the two would eventually disagree.
 *
 * ── WHY A SEPARATE MODULE ──────────────────────────────────────────────────
 * Pure functions over an explicit state object, so the awkward cases — offline,
 * signed out, a run already in flight, a server that is down — are tested
 * directly rather than by waiting on real timers in a test.
 *
 * ── THE BACKOFF HERE IS NOT THE WORKER'S BACKOFF ───────────────────────────
 * The worker backs off an individual failing sale. This backs off the whole
 * POLLING LOOP when a run cannot even complete (server unreachable, auth
 * broken). Without it a shop with no internet would fire a pointless run every
 * minute all day.
 */

/** Normal polling interval while things are healthy. */
export const DEFAULT_INTERVAL_MS = 60_000;

/** Ceiling for the polling backoff. Even a badly broken server is retried
 *  every quarter hour, so recovery never needs a restart. */
export const MAX_INTERVAL_MS = 15 * 60_000;

export interface SchedulerState {
  /** A run is in flight right now. */
  running: boolean;
  /** Epoch ms of the last completed run, successful or not. */
  lastRunAt: number | null;
  /** Consecutive runs that could not complete at all. */
  consecutiveFailures: number;
}

export const initialSchedulerState: SchedulerState = {
  running: false,
  lastRunAt: null,
  consecutiveFailures: 0,
};

export interface RunConditions {
  now: number;
  online: boolean;
  authenticated: boolean;
  /** False in a plain browser, where there is no local database. */
  bridgeAvailable: boolean;
  /** Set by the manual "Sync now" control. Bypasses the interval, never the
   *  safety checks — a person pressing a button must not be able to start a
   *  second concurrent run. */
  forced?: boolean;
}

export type SkipReason =
  | 'already-running'
  | 'offline'
  | 'signed-out'
  | 'no-local-database'
  | 'too-soon';

export type RunDecision =
  | { run: true }
  | { run: false; reason: SkipReason };

/**
 * Exponential backoff on the polling loop, capped.
 *
 * Doubling from one minute reaches the fifteen-minute ceiling after four
 * consecutive failures, which is roughly "the internet has been out for a
 * while" — slow enough to stop hammering, fast enough that nobody has to
 * think about it when the line comes back.
 */
export function intervalFor(
  consecutiveFailures: number,
  base = DEFAULT_INTERVAL_MS,
  max = MAX_INTERVAL_MS,
): number {
  if (consecutiveFailures <= 0) return base;
  const exponent = Math.min(consecutiveFailures, 8);
  return Math.min(base * 2 ** exponent, max);
}

/**
 * Should a run start right now?
 *
 * Order matters. `already-running` is checked FIRST, before the forced
 * shortcut, so the manual button can never start a second concurrent run.
 * The worker and the database claim would both reject the overlap anyway, but
 * relying on a lower layer to clean up a race this layer created is not a
 * design.
 */
export function decideRun(state: SchedulerState, c: RunConditions): RunDecision {
  if (state.running) return { run: false, reason: 'already-running' };
  if (!c.bridgeAvailable) return { run: false, reason: 'no-local-database' };
  if (!c.authenticated) return { run: false, reason: 'signed-out' };
  // Offline is not a failure. The queue is durable and billing is unaffected;
  // there is simply nowhere to send anything yet.
  if (!c.online) return { run: false, reason: 'offline' };

  if (c.forced) return { run: true };
  if (state.lastRunAt === null) return { run: true };

  const due = state.lastRunAt + intervalFor(state.consecutiveFailures);
  return c.now >= due ? { run: true } : { run: false, reason: 'too-soon' };
}

/**
 * Fold a completed run into the state.
 *
 * "Failure" means the run itself could not complete — not that a sale was
 * rejected. A run that correctly classifies ten bills as BLOCKED has done its
 * job perfectly and must NOT slow the loop down: those bills are waiting on a
 * day session being opened, and the loop needs to be there promptly when it is.
 */
export function afterRun(
  state: SchedulerState,
  result: { ok: boolean },
  now: number,
): SchedulerState {
  return {
    running: false,
    lastRunAt: now,
    consecutiveFailures: result.ok ? 0 : state.consecutiveFailures + 1,
  };
}

/** Milliseconds until the next run is due; 0 when it is due now. */
export function msUntilDue(state: SchedulerState, now: number): number {
  if (state.lastRunAt === null) return 0;
  const due = state.lastRunAt + intervalFor(state.consecutiveFailures);
  return Math.max(0, due - now);
}
