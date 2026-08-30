/**
 * Phase 7 — when the sync loop is allowed to run.
 *
 * These are the cases that decide whether a shop's takings reach the server:
 * a second run must never overlap the first, being offline must not be
 * mistaken for a failure, and a run that correctly parks bills as BLOCKED
 * must not slow the loop down — those bills are waiting on a day session and
 * the loop needs to be there promptly when one opens.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERVAL_MS,
  MAX_INTERVAL_MS,
  afterRun,
  decideRun,
  initialSchedulerState,
  intervalFor,
  msUntilDue,
  type SchedulerState,
} from '../sync-scheduler';

const NOW = 1_760_000_000_000;

const healthy = {
  now: NOW,
  online: true,
  authenticated: true,
  bridgeAvailable: true,
};

const state = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  ...initialSchedulerState,
  ...over,
});

describe('deciding whether to run', () => {
  it('runs on the very first tick', () => {
    expect(decideRun(state(), healthy)).toEqual({ run: true });
  });

  it('never starts a second overlapping run', () => {
    expect(decideRun(state({ running: true }), healthy)).toEqual({
      run: false,
      reason: 'already-running',
    });
  });

  it('refuses to overlap even when a person presses Sync now', () => {
    // The worker and the database claim would both reject the overlap, but
    // creating the race here and relying on a lower layer to clean it up is
    // not a design.
    expect(decideRun(state({ running: true }), { ...healthy, forced: true })).toEqual({
      run: false,
      reason: 'already-running',
    });
  });

  it('does not run while offline', () => {
    // Not an error: the queue is durable and billing is unaffected. There is
    // simply nowhere to send anything yet.
    expect(decideRun(state(), { ...healthy, online: false })).toEqual({
      run: false,
      reason: 'offline',
    });
  });

  it('does not run when signed out', () => {
    expect(decideRun(state(), { ...healthy, authenticated: false })).toEqual({
      run: false,
      reason: 'signed-out',
    });
  });

  it('does not run in a plain browser', () => {
    expect(decideRun(state(), { ...healthy, bridgeAvailable: false })).toEqual({
      run: false,
      reason: 'no-local-database',
    });
  });

  it('waits for the interval between runs', () => {
    const s = state({ lastRunAt: NOW });
    expect(decideRun(s, { ...healthy, now: NOW + 1_000 })).toEqual({
      run: false,
      reason: 'too-soon',
    });
    expect(decideRun(s, { ...healthy, now: NOW + DEFAULT_INTERVAL_MS })).toEqual({ run: true });
  });

  it('lets a manual trigger bypass the interval', () => {
    const s = state({ lastRunAt: NOW });
    expect(decideRun(s, { ...healthy, now: NOW + 1_000, forced: true })).toEqual({ run: true });
  });

  it('checks safety before honouring a forced run', () => {
    // Order matters: a person offline and signed out still cannot run.
    expect(
      decideRun(state(), { ...healthy, forced: true, online: false }),
    ).toEqual({ run: false, reason: 'offline' });
    expect(
      decideRun(state(), { ...healthy, forced: true, authenticated: false }),
    ).toEqual({ run: false, reason: 'signed-out' });
  });
});

describe('backoff on the polling loop', () => {
  it('polls at the base interval while healthy', () => {
    expect(intervalFor(0)).toBe(DEFAULT_INTERVAL_MS);
  });

  it('backs off as runs keep failing outright', () => {
    expect(intervalFor(1)).toBe(DEFAULT_INTERVAL_MS * 2);
    expect(intervalFor(2)).toBe(DEFAULT_INTERVAL_MS * 4);
    expect(intervalFor(3)).toBe(DEFAULT_INTERVAL_MS * 8);
  });

  it('is capped so recovery never needs a restart', () => {
    expect(intervalFor(50)).toBe(MAX_INTERVAL_MS);
    expect(intervalFor(1000)).toBeLessThanOrEqual(MAX_INTERVAL_MS);
  });

  it('a successful run clears the backoff', () => {
    const failed = afterRun(state({ consecutiveFailures: 4 }), { ok: false }, NOW);
    expect(failed.consecutiveFailures).toBe(5);

    const recovered = afterRun(failed, { ok: true }, NOW + 1);
    expect(recovered.consecutiveFailures).toBe(0);
    expect(intervalFor(recovered.consecutiveFailures)).toBe(DEFAULT_INTERVAL_MS);
  });

  it('does NOT back off when a run parks bills as blocked', () => {
    // A run that classified ten bills as BLOCKED did its job perfectly. Those
    // bills are waiting for a day session to open, and slowing the loop would
    // delay them the moment one does.
    const after = afterRun(state({ consecutiveFailures: 3 }), { ok: true }, NOW);
    expect(after.consecutiveFailures).toBe(0);
  });

  it('always clears the running flag, even after a failure', () => {
    // A run that threw must not wedge the loop shut forever.
    expect(afterRun(state({ running: true }), { ok: false }, NOW).running).toBe(false);
    expect(afterRun(state({ running: true }), { ok: true }, NOW).running).toBe(false);
  });
});

describe('time until the next run', () => {
  it('is due immediately before the first run', () => {
    expect(msUntilDue(state(), NOW)).toBe(0);
  });

  it('counts down after a run', () => {
    const s = state({ lastRunAt: NOW });
    expect(msUntilDue(s, NOW)).toBe(DEFAULT_INTERVAL_MS);
    expect(msUntilDue(s, NOW + DEFAULT_INTERVAL_MS / 2)).toBe(DEFAULT_INTERVAL_MS / 2);
  });

  it('never reports a negative delay', () => {
    expect(msUntilDue(state({ lastRunAt: NOW }), NOW + 10 * DEFAULT_INTERVAL_MS)).toBe(0);
  });
});

describe('a full offline-to-online cycle', () => {
  it('parks while offline, then runs the moment the line returns', () => {
    let s = state();

    // Shop loses the internet. Ticks keep firing and keep being parked.
    for (let i = 0; i < 5; i++) {
      expect(decideRun(s, { ...healthy, online: false }).run).toBe(false);
    }
    // Nothing was recorded as a failure — being offline is not one.
    expect(s.consecutiveFailures).toBe(0);

    // Line returns.
    expect(decideRun(s, healthy)).toEqual({ run: true });

    // The run completes and sends the backlog.
    s = afterRun({ ...s, running: true }, { ok: true }, NOW);
    expect(s.running).toBe(false);
    expect(s.consecutiveFailures).toBe(0);
    expect(decideRun(s, { ...healthy, now: NOW + DEFAULT_INTERVAL_MS })).toEqual({ run: true });
  });

  it('backs off a server that is down, then recovers immediately', () => {
    let s = state();
    for (let i = 0; i < 3; i++) {
      s = afterRun({ ...s, running: true }, { ok: false }, NOW + i);
    }
    expect(intervalFor(s.consecutiveFailures)).toBe(DEFAULT_INTERVAL_MS * 8);

    s = afterRun({ ...s, running: true }, { ok: true }, NOW + 100);
    expect(intervalFor(s.consecutiveFailures)).toBe(DEFAULT_INTERVAL_MS);
  });
});
