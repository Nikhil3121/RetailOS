/**
 * Runs the offline-sale sync worker.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The worker was built and verified in Phase 5 but nothing ever called it.
 * `sync:sales:run` had no caller, so in production a queued bill would have
 * sat in SQLite forever while the Sales screen faithfully displayed the
 * growing backlog. This is the ignition.
 *
 * ── WHY IN THE RENDERER ────────────────────────────────────────────────────
 * The worker needs an access token. Tokens live in the renderer's auth store
 * and are refreshed by api.ts. A main-process scheduler would need its own
 * copy of both, i.e. a second authentication implementation — so the trigger
 * lives where the credentials already are.
 *
 * The consequence, stated plainly: sync runs only while a window is open.
 * That is acceptable for a till (no window means no billing either) but it is
 * NOT headless background sync, and should not be described as such.
 *
 * ── IT NEVER BLOCKS THE COUNTER ────────────────────────────────────────────
 * Checkout does not wait for this and never has. If sync is stuck, slow, or
 * has never run, billing is unaffected — the queue is durable and the cashier
 * is not.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import {
  afterRun,
  decideRun,
  initialSchedulerState,
  type SchedulerState,
  type SkipReason,
} from '@/lib/sync-scheduler';

/** Poll cadence. The scheduler decides whether each tick actually runs. */
const TICK_MS = 15_000;

export interface SaleSyncRunResult {
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

export interface UseSaleSync {
  /** True while a run is in flight. */
  running: boolean;
  /** Outcome of the most recent completed run, if any. */
  lastResult: SaleSyncRunResult | null;
  lastRunAt: number | null;
  /** Why the last tick did not run, when it did not. */
  lastSkip: SkipReason | null;
  /** Manual trigger. Resolves to null when the run was skipped. */
  runNow: () => Promise<SaleSyncRunResult | null>;
}

function bridge() {
  return typeof window !== 'undefined' ? window.retailos?.sync : undefined;
}

export function useSaleSync(): UseSaleSync {
  const accessToken = useAuthStore((s) => s.accessToken);
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);

  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<SaleSyncRunResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [lastSkip, setLastSkip] = useState<SkipReason | null>(null);

  // The scheduler state lives in a ref, not React state: the tick must read
  // the CURRENT value, and a stale closure over a re-rendered value could
  // start a second overlapping run.
  const stateRef = useRef<SchedulerState>(initialSchedulerState);
  // Tokens change on refresh; read them at run time rather than capturing.
  const tokenRef = useRef<string | null>(accessToken);
  tokenRef.current = accessToken;
  const authedRef = useRef(status === 'authenticated');
  authedRef.current = status === 'authenticated';

  const attempt = useCallback(
    async (forced: boolean): Promise<SaleSyncRunResult | null> => {
      const sync = bridge();
      const decision = decideRun(stateRef.current, {
        now: Date.now(),
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        authenticated: authedRef.current && !!tokenRef.current,
        bridgeAvailable: !!sync,
        forced,
      });

      if (!decision.run) {
        setLastSkip(decision.reason);
        return null;
      }

      setLastSkip(null);
      stateRef.current = { ...stateRef.current, running: true };
      setRunning(true);

      let result: SaleSyncRunResult = {
        ok: false,
        attempted: 0, synced: 0, retryable: 0, permanent: 0,
        blocked: 0, divergent: 0, durationMs: 0,
        error: 'Sync did not complete.',
      };

      try {
        // The token and the server that issued it travel together. Without
        // this the worker fell back to its own configured URL, which could be
        // a different backend entirely — every sale then failed with
        // INVALID_TOKEN and retried forever.
        const res = (await sync!.runSales(
          tokenRef.current as string,
          undefined,
          API_BASE_URL,
        )) as
          | { ok: true; data: SaleSyncRunResult }
          | { ok: false; error: string };

        if (res.ok) {
          result = res.data;
          // An expired shift token shows up as retryable auth failures. The
          // worker deliberately does NOT treat that as permanent, so refresh
          // once here and let the next tick carry the bills through rather
          // than leaving real revenue stuck behind a stale token.
          if (result.retryable > 0 && result.synced === 0) {
            void refresh();
          }
        } else {
          result = { ...result, error: res.error };
        }
      } catch (err) {
        // A failed run must never take the POS down with it.
        result = {
          ...result,
          error: err instanceof Error ? err.message : 'Sync failed.',
        };
      }

      const now = Date.now();
      stateRef.current = afterRun(stateRef.current, result, now);
      setRunning(false);
      setLastResult(result);
      setLastRunAt(now);
      return result;
    },
    [refresh],
  );

  const runNow = useCallback(() => attempt(true), [attempt]);

  // ---- the loop ----------------------------------------------------------
  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    const tick = () => {
      if (!cancelled) void attempt(false);
    };

    // Drain immediately on sign-in: a terminal that has been closed overnight
    // should not wait a full interval before pushing yesterday's bills.
    tick();
    const timer = setInterval(tick, TICK_MS);

    // The connection coming back is the single most useful moment to try.
    // The scheduler's backoff is bypassed here on purpose: "online" is real
    // evidence that the previous failures no longer apply.
    const onOnline = () => {
      stateRef.current = { ...stateRef.current, consecutiveFailures: 0 };
      tick();
    };
    // Waking from sleep or refocusing the till fires this; treat it as a
    // cheap prompt to catch up.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, attempt]);

  return { running, lastResult, lastRunAt, lastSkip, runNow };
}
