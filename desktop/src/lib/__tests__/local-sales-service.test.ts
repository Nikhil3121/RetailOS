/**
 * Phase 6 — the renderer's read-only view of local sales.
 *
 * The service must never throw. These screens run on a shop counter during an
 * outage, which is exactly when the bridge may be missing or unhappy; a
 * reporting panel that crashes takes the page down with it, while one that
 * shows nothing is merely unhelpful.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isLocalSalesAvailable,
  listLocalSales,
  needsAttention,
  paiseToDisplay,
  unsyncedCount,
  type LocalSaleSummary,
} from '../local-sales-service';

const row = (over: Partial<LocalSaleSummary> = {}): LocalSaleSummary => ({
  id: 'sale-1',
  localReference: 'OFFLINE-T1-000001',
  invoiceNumber: null,
  serverId: null,
  totalPaise: 24000,
  createdAt: '2026-03-31T18:05:00.000Z',
  occurredAt: '2026-03-31T18:05:00.000Z',
  syncedAt: null,
  terminalUuid: 'device-1',
  serverDaySessionId: 'session-1',
  attemptCount: 0,
  nextAttemptAt: null,
  error: null,
  state: 'QUEUED',
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('money display', () => {
  it('formats paise without dividing', () => {
    expect(paiseToDisplay(24000)).toBe('240.00');
    expect(paiseToDisplay(0)).toBe('0.00');
    expect(paiseToDisplay(5)).toBe('0.05');
    expect(paiseToDisplay(8_675_309)).toBe('86753.09');
  });

  it('agrees with the exact values the receipt shows', () => {
    // The same integers the invoice renders. If these ever disagree, the
    // list and the bill would show different money for one sale.
    for (const paise of [24000, 24010, 28436, 334170]) {
      expect(paiseToDisplay(paise)).toBe((paise / 100).toFixed(2));
    }
  });
});

describe('summaries', () => {
  it('counts everything not yet on the server', () => {
    const sales = [
      row({ state: 'SYNCED' }),
      row({ state: 'QUEUED' }),
      row({ state: 'BLOCKED' }),
      row({ state: 'FAILED' }),
    ];
    expect(unsyncedCount(sales)).toBe(3);
  });

  it('flags only FAILED as needing a person', () => {
    // BLOCKED clears itself when a day session opens. Listing it as needing
    // attention would send staff chasing a bill that is already fine.
    const sales = [row({ state: 'BLOCKED' }), row({ state: 'FAILED' }), row({ state: 'SYNCED' })];
    expect(needsAttention(sales).map((s) => s.state)).toEqual(['FAILED']);
  });

  it('reports a fully synced terminal as having nothing pending', () => {
    expect(unsyncedCount([row({ state: 'SYNCED' })])).toBe(0);
  });
});

describe('bridge handling', () => {
  it('reports unavailable outside Electron', () => {
    vi.stubGlobal('window', {});
    expect(isLocalSalesAvailable()).toBe(false);
  });

  it('returns an empty list rather than throwing when the bridge is absent', async () => {
    vi.stubGlobal('window', {});
    await expect(listLocalSales()).resolves.toEqual([]);
  });

  it('returns an empty list when the bridge rejects', async () => {
    vi.stubGlobal('window', {
      retailos: { db: { listSales: () => Promise.reject(new Error('boom')) } },
    });
    await expect(listLocalSales()).resolves.toEqual([]);
  });

  it('returns an empty list when the handler reports failure', async () => {
    vi.stubGlobal('window', {
      retailos: { db: { listSales: async () => ({ ok: false, error: 'nope' }) } },
    });
    await expect(listLocalSales()).resolves.toEqual([]);
  });

  it('passes through the rows on success', async () => {
    const sales = [row(), row({ id: 'sale-2', state: 'SYNCED' })];
    vi.stubGlobal('window', {
      retailos: { db: { listSales: async () => ({ ok: true, data: sales }) } },
    });
    await expect(listLocalSales()).resolves.toEqual(sales);
  });

  it('forwards the requested limit', async () => {
    const listSales = vi.fn(async () => ({ ok: true, data: [] }));
    vi.stubGlobal('window', { retailos: { db: { listSales } } });

    await listLocalSales(25);
    expect(listSales).toHaveBeenCalledWith(25);
  });
});
