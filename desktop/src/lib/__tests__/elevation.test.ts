/**
 * The client-side half of the password gate.
 *
 * The server is what actually refuses an ungated delete; this module only
 * decides whether to ask again and what header to attach. The properties worth
 * pinning are the ones that would quietly weaken the gate: a token that outlives
 * its window, or one that survives a sign-out.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearElevation,
  elevationHeader,
  elevationSecondsLeft,
  hasLiveElevation,
  storeElevation,
  ELEVATION_HEADER,
} from '@/lib/elevation';

beforeEach(() => {
  clearElevation();
  vi.useRealTimers();
});

describe('elevation', () => {
  it('holds nothing until a password is confirmed', () => {
    expect(hasLiveElevation()).toBe(false);
    expect(elevationHeader()).toEqual({});
  });

  it('attaches the header once confirmed', () => {
    storeElevation('tok-123', 300);
    expect(hasLiveElevation()).toBe(true);
    expect(elevationHeader()).toEqual({ [ELEVATION_HEADER]: 'tok-123' });
  });

  it('expires, so an unattended till re-locks itself', () => {
    vi.useFakeTimers();
    storeElevation('tok-123', 300);
    expect(hasLiveElevation()).toBe(true);

    vi.advanceTimersByTime(301_000);
    expect(hasLiveElevation()).toBe(false);
    expect(elevationHeader()).toEqual({});
  });

  it('gives up slightly early, so a request cannot land after expiry', () => {
    vi.useFakeTimers();
    storeElevation('tok-123', 300);

    // Five seconds before the server's deadline: still inside the skew, so we
    // ask again rather than send a token that may arrive too late.
    vi.advanceTimersByTime(295_000);
    expect(hasLiveElevation()).toBe(false);
  });

  it('reports the time left', () => {
    vi.useFakeTimers();
    storeElevation('tok-123', 300);
    expect(elevationSecondsLeft()).toBe(285); // 300 less the 15s skew

    vi.advanceTimersByTime(400_000);
    expect(elevationSecondsLeft()).toBe(0);
  });

  it('is dropped on sign-out', () => {
    storeElevation('tok-123', 300);
    clearElevation();
    expect(hasLiveElevation()).toBe(false);
    expect(elevationHeader()).toEqual({});
  });
});
