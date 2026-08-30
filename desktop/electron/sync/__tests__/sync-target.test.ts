/**
 * Where a token is allowed to be sent.
 *
 * These cases come from a real failure: a cashier logged in against the hosted
 * backend, the sync worker posted that token to localhost, and every sale came
 * back 401 INVALID_TOKEN and retried forever. The bills were safe but were
 * never going to arrive, and the only symptom was a log nobody was watching.
 */

import { describe, expect, it } from 'vitest';

import { resolveSyncTarget } from '../sync-target';

const HOSTED = 'https://retailos-backend-8jwi.onrender.com';
const LOCAL = 'http://127.0.0.1:8000';

describe('choosing where to send a queued sale', () => {
  it('uses where the renderer signed in when nothing is configured', () => {
    // The token came from there, so that is the only place it means anything.
    expect(resolveSyncTarget(HOSTED, null)).toEqual({
      ok: true,
      url: HOSTED,
      source: 'renderer',
    });
  });

  it('honours an explicit override when it agrees', () => {
    const result = resolveSyncTarget(LOCAL, LOCAL);
    expect(result).toEqual({ ok: true, url: LOCAL, source: 'configured' });
  });

  it('REFUSES when the two disagree', () => {
    // The actual bug. Sending to the configured URL repeats it; sending to
    // the renderer's silently ignores an operator's setting. Neither is a
    // decision this code gets to make.
    const result = resolveSyncTarget(HOSTED, LOCAL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('retailos-backend-8jwi.onrender.com');
    expect(result.error).toContain('127.0.0.1:8000');
  });

  it('names both servers so the fix is obvious from the message alone', () => {
    const result = resolveSyncTarget(HOSTED, LOCAL);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toMatch(/signed in to/i);
    expect(result.error).toMatch(/will not be sent/i);
  });

  it('treats trailing slashes and case as the same server', () => {
    expect(resolveSyncTarget(`${LOCAL}/`, LOCAL).ok).toBe(true);
    expect(resolveSyncTarget('http://LOCALHOST:8000', 'http://localhost:8000').ok).toBe(true);
  });

  it('treats a different port as a different server', () => {
    // Two backends on one machine is exactly how this goes wrong locally.
    expect(resolveSyncTarget('http://127.0.0.1:8000', 'http://127.0.0.1:9000').ok).toBe(false);
  });

  it('treats http and https as different servers', () => {
    expect(resolveSyncTarget('http://example.com', 'https://example.com').ok).toBe(false);
  });

  it('falls back to the configured value for a caller that supplies nothing', () => {
    // Keeps older callers and the existing tests working unchanged.
    expect(resolveSyncTarget(null, LOCAL)).toEqual({
      ok: true,
      url: LOCAL,
      source: 'configured',
    });
    expect(resolveSyncTarget(undefined, LOCAL).ok).toBe(true);
  });

  it('refuses when there is no address at all', () => {
    const result = resolveSyncTarget(null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no api address/i);
  });

  it('rejects an address that is not a usable http endpoint', () => {
    for (const bad of ['not a url', 'file:///etc/passwd', 'data:text/plain,x', 'ftp://x.com']) {
      expect(resolveSyncTarget(bad, null).ok).toBe(false);
    }
  });

  it('never sends a token somewhere the renderer did not authenticate', () => {
    // The security property, stated directly: every successful resolution
    // returns an origin the renderer either named or explicitly agreed with.
    for (const [renderer, configured] of [
      [HOSTED, null],
      [LOCAL, null],
      [LOCAL, LOCAL],
      [HOSTED, `${HOSTED}/`],
    ] as [string, string | null][]) {
      const result = resolveSyncTarget(renderer, configured);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(new URL(result.url).origin).toBe(new URL(renderer).origin);
      }
    }
  });
});
