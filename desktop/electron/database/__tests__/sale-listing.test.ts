/**
 * Phase 6 — the read path behind the sync-visibility screens.
 *
 * These screens exist so a cashier can answer "did last night's bills reach
 * the server?" The answer has to be RIGHT: reporting a synced sale as pending
 * sends someone chasing money that is already banked, and reporting a pending
 * one as synced hides real revenue that never arrived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let tempDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tempDir },
  ipcMain: { handle: vi.fn() },
}));

import { closeDatabase, openDatabase } from '../connection';
import { runMigrations } from '../migrations';
import { DeviceRepository } from '../repositories/device-repository';
import {
  SaleRepository,
  deriveSyncState,
  type SaleInput,
} from '../repositories/sale-repository';

function freshDb() {
  const db = openDatabase(path.join(tempDir, `p6-${randomUUID()}.db`));
  runMigrations(db);
  new DeviceRepository(db).getOrCreate();
  return db;
}

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  serverStoreId: '33333333-3333-4333-8333-333333333333',
  serverDaySessionId: '88888888-8888-4888-8888-888888888888',
  terminalUuid: '99999999-9999-4999-8999-999999999999',
  items: [
    {
      productId: null,
      serverVariantId: '44444444-4444-4444-8444-444444444444',
      productName: 'SHORT KURTI 660',
      sku: '160055.003',
      quantity: 1,
      unitPricePaise: 34300,
      discountPctBp: 3000,
      discountPaise: 10290,
      taxRateBp: 500,
      taxPaise: 1143,
      lineTotalPaise: 24000,
    },
  ],
  payments: [{ method: 'cash', amountPaise: 24000, reference: null }],
  ...over,
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-p6-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

describe('sync state derivation', () => {
  const base = {
    serverId: null,
    saleSyncStatus: 'PENDING',
    queueStatus: 'PENDING' as string | null,
    failureKind: null as string | null,
  };

  it('maps each queue state to the word a cashier sees', () => {
    expect(deriveSyncState({ ...base, queueStatus: null })).toBe('LOCAL');
    expect(deriveSyncState({ ...base, queueStatus: 'PENDING' })).toBe('QUEUED');
    expect(deriveSyncState({ ...base, queueStatus: 'PROCESSING' })).toBe('SYNCING');
    expect(deriveSyncState({ ...base, queueStatus: 'SYNCED' })).toBe('SYNCED');
    expect(deriveSyncState({ ...base, queueStatus: 'FAILED' })).toBe('FAILED');
  });

  it('separates BLOCKED from FAILED', () => {
    // They need opposite responses: blocked clears itself once a day session
    // opens; failed needs a person. Collapsing them would hide that.
    expect(
      deriveSyncState({ ...base, queueStatus: 'PENDING', failureKind: 'BLOCKED' }),
    ).toBe('BLOCKED');
    expect(
      deriveSyncState({ ...base, queueStatus: 'FAILED', failureKind: 'PERMANENT' }),
    ).toBe('FAILED');
  });

  it('trusts a server id over everything else', () => {
    // Once the server has acknowledged a sale it IS synced, even if the queue
    // row was pruned or a later bookkeeping step was interrupted. Saying
    // otherwise sends someone chasing money that is already banked.
    expect(
      deriveSyncState({
        serverId: 'srv-1',
        saleSyncStatus: 'PENDING',
        queueStatus: 'PENDING',
        failureKind: null,
      }),
    ).toBe('SYNCED');
    expect(
      deriveSyncState({
        serverId: 'srv-1',
        saleSyncStatus: 'PENDING',
        queueStatus: null,
        failureKind: null,
      }),
    ).toBe('SYNCED');
  });

  it('reports a pruned-but-synced sale as synced, not local', () => {
    expect(
      deriveSyncState({
        serverId: null,
        saleSyncStatus: 'SYNCED',
        queueStatus: null,
        failureKind: null,
      }),
    ).toBe('SYNCED');
  });
});

describe('listing local sales', () => {
  it('returns a freshly committed sale as QUEUED', () => {
    const db = freshDb();
    const id = new SaleRepository(db).create(sale());

    const rows = new SaleRepository(db).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].state).toBe('QUEUED');
    expect(rows[0].localReference).toMatch(/^OFFLINE-/);
  });

  it('reports money exactly as stored, never recomputed', () => {
    const db = freshDb();
    new SaleRepository(db).create(sale());
    expect(new SaleRepository(db).list()[0].totalPaise).toBe(24000);
  });

  it('surfaces the attribution the detail screen shows', () => {
    const db = freshDb();
    new SaleRepository(db).create(sale({ occurredAt: '2026-03-31T18:05:00.000Z' }));

    const row = new SaleRepository(db).list()[0];
    expect(row.serverDaySessionId).toBe('88888888-8888-4888-8888-888888888888');
    expect(row.terminalUuid).toBe('99999999-9999-4999-8999-999999999999');
    expect(row.occurredAt).toBe('2026-03-31T18:05:00.000Z');
  });

  it('reports a blocked sale with its reason and retry time', () => {
    const db = freshDb();
    const id = new SaleRepository(db).create(sale());
    db.prepare(
      `UPDATE sync_queue SET failure_kind='BLOCKED', error='NO_OPEN_DAY_SESSION: closed',
         next_attempt_at='2026-09-01T10:00:00.000Z' WHERE entity_id=?`,
    ).run(id);

    const row = new SaleRepository(db).list()[0];
    expect(row.state).toBe('BLOCKED');
    expect(row.error).toContain('NO_OPEN_DAY_SESSION');
    expect(row.nextAttemptAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('reports a permanently failed sale with its attempt count', () => {
    const db = freshDb();
    const id = new SaleRepository(db).create(sale());
    db.prepare(
      `UPDATE sync_queue SET status='FAILED', failure_kind='PERMANENT',
         attempt_count=3, error='VARIANT_NOT_FOUND: gone' WHERE entity_id=?`,
    ).run(id);

    const row = new SaleRepository(db).list()[0];
    expect(row.state).toBe('FAILED');
    expect(row.attemptCount).toBe(3);
    expect(row.error).toContain('VARIANT_NOT_FOUND');
  });

  it('reports a synced sale with its server identifiers', () => {
    const db = freshDb();
    const repo = new SaleRepository(db);
    const id = repo.create(sale());
    repo.markSynced(id, 'server-sale-1', 'INV-MS-202603-0001', 1143, 24000);

    const row = repo.list()[0];
    expect(row.state).toBe('SYNCED');
    expect(row.invoiceNumber).toBe('INV-MS-202603-0001');
    expect(row.serverId).toBe('server-sale-1');
    expect(row.syncedAt).toBeTruthy();
  });

  it('orders newest first and respects the limit', () => {
    const db = freshDb();
    const repo = new SaleRepository(db);
    const ids = [repo.create(sale()), repo.create(sale()), repo.create(sale())];
    ids.forEach((id, i) =>
      db
        .prepare('UPDATE sale SET created_at = ? WHERE id = ?')
        .run(`2026-01-0${i + 1}T00:00:00.000Z`, id),
    );

    expect(repo.list().map((r) => r.id)).toEqual([...ids].reverse());
    expect(repo.list(2)).toHaveLength(2);
  });

  it('is read-only — listing does not disturb the queue', () => {
    const db = freshDb();
    new SaleRepository(db).create(sale());
    const before = db.prepare('SELECT * FROM sync_queue').all();

    new SaleRepository(db).list();

    expect(db.prepare('SELECT * FROM sync_queue').all()).toEqual(before);
  });

  it('still lists a sale whose queue row was pruned', () => {
    const db = freshDb();
    const repo = new SaleRepository(db);
    const id = repo.create(sale());
    repo.markSynced(id, 'server-sale-1', 'INV-1', 1143, 24000);
    db.prepare('DELETE FROM sync_queue WHERE entity_id = ?').run(id);

    const rows = repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('SYNCED');
  });

  it('returns nothing for an empty database rather than throwing', () => {
    expect(new SaleRepository(freshDb()).list()).toEqual([]);
  });
});
