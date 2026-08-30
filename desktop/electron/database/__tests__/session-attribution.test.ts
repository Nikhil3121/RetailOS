/**
 * Phase 5E — the attribution captured at the counter must survive everything.
 *
 * The invariant under test:
 *
 *     SALE-TIME SESSION -> SQLite snapshot -> (restart) -> unchanged
 *
 * If the session, occurrence time or terminal can drift between the moment a
 * bill is rung up and the moment it is pushed, the sale can be booked into the
 * wrong shift — which is the defect this phase exists to remove.
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
import { MIGRATIONS, currentSchemaVersion, runMigrations } from '../migrations';
import { DeviceRepository } from '../repositories/device-repository';
import { SaleRepository, type SaleInput } from '../repositories/sale-repository';

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

const SESSION = '88888888-8888-4888-8888-888888888888';
const DEVICE = '99999999-9999-4999-8999-999999999999';
const OCCURRED = '2026-03-31T18:05:00.000Z';

function freshDb(file?: string, upTo?: number) {
  const target = file ?? path.join(tempDir, `p5e-${randomUUID()}.db`);
  const db = openDatabase(target);
  runMigrations(db, upTo ? MIGRATIONS.filter((m) => m.version <= upTo) : MIGRATIONS);
  new DeviceRepository(db).getOrCreate();
  return { db, file: target };
}

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  serverStoreId: '33333333-3333-4333-8333-333333333333',
  serverDaySessionId: SESSION,
  terminalUuid: DEVICE,
  occurredAt: OCCURRED,
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-p5e-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

describe('migration 007', () => {
  it('is registered and reaches the latest version', () => {
    const { db } = freshDb();
    expect(currentSchemaVersion(db)).toBe(LATEST);
    expect(LATEST).toBeGreaterThanOrEqual(7);
  });

  it('adds the attribution columns and their indexes', () => {
    const { db } = freshDb();
    const cols = (db.prepare('PRAGMA table_info(sale)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('server_day_session_id');
    expect(cols).toContain('occurred_at');
    expect(cols).toContain('terminal_uuid');

    const idx = (db.prepare('PRAGMA index_list(sale)').all() as { name: string }[]).map(
      (i) => i.name,
    );
    expect(idx).toContain('idx_sale_terminal_uuid');
    expect(idx).toContain('idx_sale_server_day_session');
  });

  it('is idempotent — a second run applies nothing', () => {
    const { db, file } = freshDb();
    closeDatabase();
    const reopened = openDatabase(file);
    const second = runMigrations(reopened);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain(7);
    expect(currentSchemaVersion(reopened)).toBe(LATEST);
  });

  it('leaves a sale written before 007 readable, with null attribution', () => {
    // Build at version 6, write a sale, then migrate to 7.
    const { db, file } = freshDb(undefined, 6);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sale (id, status, subtotal_paise, discount_paise, tax_paise,
         total_paise, local_reference, created_at, updated_at, sync_status)
       VALUES (?, 'COMPLETED', 85619, 0, 4281, 89900, 'OFFLINE-OLD-000001',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'PENDING')`,
    ).run(id);
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened); // applies 007
    const record = new SaleRepository(reopened).get(id);

    // Financial values untouched by the migration.
    expect(record?.totalPaise).toBe(89900);
    expect(record?.taxPaise).toBe(4281);
    expect(record?.localReference).toBe('OFFLINE-OLD-000001');
    // Attribution is honestly absent rather than invented.
    expect(record?.serverDaySessionId).toBeNull();
    expect(record?.occurredAt).toBeNull();
    expect(record?.terminalUuid).toBeNull();
  });
});

describe('attribution is captured at the counter', () => {
  it('stores the session, occurrence time and terminal', () => {
    const { db } = freshDb();
    const record = new SaleRepository(db).get(new SaleRepository(db).create(sale()));

    expect(record?.serverDaySessionId).toBe(SESSION);
    expect(record?.occurredAt).toBe(OCCURRED);
    expect(record?.terminalUuid).toBe(DEVICE);
  });

  it('defaults occurred_at to the commit time when none is supplied', () => {
    const { db } = freshDb();
    const before = Date.now();
    const record = new SaleRepository(db).get(
      new SaleRepository(db).create(sale({ occurredAt: null })),
    );

    expect(record?.occurredAt).toBeTruthy();
    const at = new Date(record!.occurredAt as string).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('accepts a sale with no terminal — an unknown till must not block a bill', () => {
    const { db } = freshDb();
    const record = new SaleRepository(db).get(
      new SaleRepository(db).create(sale({ terminalUuid: null })),
    );
    expect(record).not.toBeNull();
    expect(record?.terminalUuid).toBeNull();
    expect(record?.totalPaise).toBe(24000);
  });

  it('keeps two terminals distinct in the local store', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    repo.create(sale({ terminalUuid: 'terminal-a' }));
    repo.create(sale({ terminalUuid: 'terminal-b' }));

    const rows = db
      .prepare('SELECT terminal_uuid, COUNT(*) AS n FROM sale GROUP BY terminal_uuid')
      .all() as { terminal_uuid: string; n: number }[];
    expect(rows).toHaveLength(2);
  });
});

describe('attribution survives a restart', () => {
  it('keeps the sale-time session after close and reopen', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const record = new SaleRepository(reopened).get(id);

    // The whole point: the session does not drift to "whatever is current".
    expect(record?.serverDaySessionId).toBe(SESSION);
    expect(record?.occurredAt).toBe(OCCURRED);
    expect(record?.terminalUuid).toBe(DEVICE);
  });

  it('does not regenerate device_uuid across a restart', () => {
    const { db, file } = freshDb();
    const first = new DeviceRepository(db).getOrCreate();
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const second = new DeviceRepository(reopened).getOrCreate();

    expect(second.deviceUuid).toBe(first.deviceUuid);
  });

  it('mints a NEW device_uuid for a fresh database, and does not pretend otherwise', () => {
    // Documents reinstall behaviour: wiping the database is a new terminal.
    // Silently reusing an old identity would misattribute another till's sales.
    const a = freshDb();
    const firstUuid = new DeviceRepository(a.db).getOrCreate().deviceUuid;
    closeDatabase();

    const b = freshDb();
    const secondUuid = new DeviceRepository(b.db).getOrCreate().deviceUuid;

    expect(secondUuid).not.toBe(firstUuid);
  });

  it('a pending queue entry still carries the original attribution', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const queued = reopened
      .prepare("SELECT status FROM sync_queue WHERE entity_id = ?")
      .get(id) as { status: string };

    expect(queued.status).toBe('PENDING');
    expect(new SaleRepository(reopened).get(id)?.serverDaySessionId).toBe(SESSION);
  });
});
