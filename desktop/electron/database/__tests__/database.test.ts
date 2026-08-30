/**
 * Foundation tests.
 *
 * These run against a REAL SQLite file in a temp directory — not a mock. A
 * mock would prove the code calls the driver; it would not prove the schema is
 * valid, the transactions roll back, or the constraints hold. For a database
 * foundation those are the only things worth testing.
 *
 * `electron` is stubbed because `app.getPath` is unavailable outside a running
 * Electron process. Nothing else is faked.
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
import { currentSchemaVersion, MIGRATIONS, runMigrations } from '../migrations';
import { DeviceRepository } from '../repositories/device-repository';
import { SaleRepository } from '../repositories/sale-repository';
import { SyncRepository, backoffFor } from '../repositories/sync-repository';
import { ProductRepository } from '../repositories/product-repository';

function freshDb() {
  const file = path.join(tempDir, `test-${randomUUID()}.db`);
  const db = openDatabase(file);
  runMigrations(db);
  return { db, file };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-test-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Windows sometimes holds the WAL file briefly after close; a leaked temp
    // directory is harmless and must not fail the suite.
  }
});

describe('migrations', () => {
  it('creates every foundation table', () => {
    const { db } = freshDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);

    for (const expected of [
      'device', 'store', 'terminal', 'product', 'product_barcode', 'price',
      'tax_rule', 'customer', 'sale', 'sale_item', 'payment', 'held_bill',
      'sync_queue', 'sync_state', 'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('is idempotent — a second run applies nothing', () => {
    const { db } = freshDb();
    const second = runMigrations(db);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toContain(1);
    expect(second.skipped).toContain(2);
  });

  it('records the applied version', () => {
    const { db } = freshDb();
    // Grows as migrations are added; assert against the manifest rather than
    // a literal so a new migration does not require editing this test.
    const highest = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(currentSchemaVersion(db)).toBe(highest);
  });

  it('rejects duplicate versions', () => {
    const { db } = freshDb();
    const dupes = [MIGRATIONS[0], { ...MIGRATIONS[0], name: 'copy' }];
    expect(() => runMigrations(db, dupes)).toThrow(/[Dd]uplicate/);
  });

  it('rolls back a failing migration and leaves the version unchanged', () => {
    const { db } = freshDb();
    const before = currentSchemaVersion(db);

    const bad = {
      version: 99,
      name: 'intentionally-broken',
      up: (d: typeof db) => {
        d.exec('CREATE TABLE should_not_survive (id TEXT)');
        throw new Error('boom');
      },
    };

    expect(() => runMigrations(db, [bad])).toThrow('boom');
    expect(currentSchemaVersion(db)).toBe(before);

    const survived = db
      .prepare("SELECT name FROM sqlite_master WHERE name='should_not_survive'")
      .get();
    expect(survived).toBeUndefined();
  });

  it('does not destroy existing data when reopened', () => {
    const { db, file } = freshDb();
    new DeviceRepository(db).getOrCreate();
    const uuid = new DeviceRepository(db).find()?.deviceUuid;
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    expect(new DeviceRepository(reopened).find()?.deviceUuid).toBe(uuid);
  });
});

describe('device identity', () => {
  it('creates a UUID on first call', () => {
    const { db } = freshDb();
    const identity = new DeviceRepository(db).getOrCreate();
    expect(identity.deviceUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('never regenerates on subsequent calls', () => {
    const { db } = freshDb();
    const repo = new DeviceRepository(db);
    expect(repo.getOrCreate().deviceUuid).toBe(repo.getOrCreate().deviceUuid);
  });

  it('survives a close and reopen', () => {
    const { db, file } = freshDb();
    const first = new DeviceRepository(db).getOrCreate().deviceUuid;
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    expect(new DeviceRepository(reopened).getOrCreate().deviceUuid).toBe(first);
  });

  it('keeps the UUID when terminal assignment changes', () => {
    const { db } = freshDb();
    const repo = new DeviceRepository(db);
    const original = repo.getOrCreate().deviceUuid;

    const updated = repo.updateAssignment({ terminalCode: 'C1', storeId: 'store-1' });
    expect(updated.deviceUuid).toBe(original);
    expect(updated.terminalCode).toBe('C1');
  });

  it('enforces a single device row', () => {
    const { db } = freshDb();
    new DeviceRepository(db).getOrCreate();
    expect(() =>
      db
        .prepare(
          `INSERT INTO device (singleton_guard, device_uuid, created_at, updated_at)
           VALUES (2, 'x', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
  });
});

describe('sale transaction primitives', () => {
  const baseSale = {
    subtotalPaise: 10000,
    totalPaise: 10000,
    items: [
      {
        productId: null,
        productName: 'Cotton Shirt',
        quantity: 1,
        unitPricePaise: 10000,
        lineTotalPaise: 10000,
      },
    ],
  };

  it('generates unique ids across calls', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const ids = new Set(Array.from({ length: 50 }, () => repo.create(baseSale)));
    expect(ids.size).toBe(50);
  });

  it('separates internal id from invoice number', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const id = repo.create(baseSale);

    // Invoice number is null until assigned — proving identity does not
    // depend on it.
    expect(repo.get(id)?.invoiceNumber).toBeNull();

    repo.markSynced(id, 'server-123', 'MSM-C1-000001');
    const after = repo.get(id);
    expect(after?.id).toBe(id);            // unchanged
    expect(after?.invoiceNumber).toBe('MSM-C1-000001');
    expect(after?.serverId).toBe('server-123');
  });

  it('writes items and payments atomically', () => {
    const { db } = freshDb();
    const id = new SaleRepository(db).create({
      ...baseSale,
      items: [
        { ...baseSale.items[0] },
        { ...baseSale.items[0], productName: 'Silk Saree' },
      ],
      payments: [{ method: 'cash', amountPaise: 10000 }],
    });

    const record = new SaleRepository(db).get(id);
    expect(record?.items).toHaveLength(2);
    expect(record?.payments).toHaveLength(1);
  });

  it('rolls the whole sale back if any line fails', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const before = repo.count();

    expect(() =>
      repo.create({
        ...baseSale,
        items: [
          { ...baseSale.items[0] },
          // NOT NULL violation on product_name — the second line must take
          // the first one down with it.
          { ...baseSale.items[0], productName: null as unknown as string },
        ],
      }),
    ).toThrow();

    expect(repo.count()).toBe(before);
    const orphans = db.prepare('SELECT COUNT(*) AS n FROM sale_item').get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it('enqueues the sale for sync in the same transaction', () => {
    const { db } = freshDb();
    const id = new SaleRepository(db).create(baseSale);
    const queued = db
      .prepare("SELECT * FROM sync_queue WHERE entity_type='sale' AND entity_id=?")
      .get(id) as { operation: string; status: string } | undefined;

    expect(queued).toBeDefined();
    expect(queued?.operation).toBe('CREATE');
    expect(queued?.status).toBe('PENDING');
  });
});

describe('sync queue', () => {
  it('enqueues and claims pending work', () => {
    const { db } = freshDb();
    const sync = new SyncRepository(db);
    sync.enqueue({ entityType: 'sale', entityId: randomUUID(), operation: 'CREATE', payload: {} });

    const batch = sync.claimBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0].status).toBe('PROCESSING');
  });

  it('does not re-claim rows already processing', () => {
    const { db } = freshDb();
    const sync = new SyncRepository(db);
    sync.enqueue({ entityType: 'sale', entityId: randomUUID(), operation: 'CREATE', payload: {} });

    expect(sync.claimBatch()).toHaveLength(1);
    expect(sync.claimBatch()).toHaveLength(0);
  });

  it('marks completion', () => {
    const { db } = freshDb();
    const sync = new SyncRepository(db);
    const qid = sync.enqueue({
      entityType: 'sale', entityId: randomUUID(), operation: 'CREATE', payload: {},
    });
    sync.markSynced(qid);
    expect(sync.counts().SYNCED).toBe(1);
  });

  it('retries with growing backoff, then gives up', () => {
    const { db } = freshDb();
    const sync = new SyncRepository(db);
    const qid = sync.enqueue({
      entityType: 'sale', entityId: randomUUID(), operation: 'CREATE', payload: {},
    });

    sync.markFailed(qid, 'network down', 3);
    let row = db.prepare('SELECT * FROM sync_queue WHERE id=?').get(qid) as {
      status: string; attempt_count: number; next_attempt_at: string | null;
    };
    expect(row.status).toBe('PENDING');       // still retrying
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at).not.toBeNull();

    sync.markFailed(qid, 'network down', 3);
    sync.markFailed(qid, 'network down', 3);
    row = db.prepare('SELECT * FROM sync_queue WHERE id=?').get(qid) as typeof row;
    expect(row.status).toBe('FAILED');        // exhausted
  });

  it('increases backoff monotonically', () => {
    expect(backoffFor(0)).toBeLessThan(backoffFor(1));
    expect(backoffFor(1)).toBeLessThan(backoffFor(3));
    // Capped, not unbounded.
    expect(backoffFor(99)).toBe(backoffFor(50));
  });

  it('rejects an invalid operation at the schema level', () => {
    const { db } = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, created_at)
           VALUES (?, 'sale', 'x', 'UPSERT', '{}', 'now')`,
        )
        .run(randomUUID()),
    ).toThrow();
  });

  it('tracks per-entity sync state with a cursor', () => {
    const { db } = freshDb();
    const sync = new SyncRepository(db);
    sync.upsertState({ entity: 'product', lastServerCursor: '1000', syncStatus: 'IDLE' });
    sync.upsertState({ entity: 'product', lastServerCursor: '2000', syncStatus: 'IDLE' });
    expect(sync.getState('product')?.lastServerCursor).toBe('2000');
  });
});

describe('product repository', () => {
  function seedProduct(db: ReturnType<typeof freshDb>['db']) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO product (id, name, sku, hsn, is_active, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(id, 'Cotton Shirt 50%', 'SKU-100', '6205', now);
    db.prepare(
      'INSERT INTO product_barcode (id, product_id, barcode, is_primary) VALUES (?, ?, ?, 1)',
    ).run(randomUUID(), id, '8901234567890');
    return id;
  }

  it('finds by exact barcode', () => {
    const { db } = freshDb();
    seedProduct(db);
    expect(new ProductRepository(db).findByCode('8901234567890')?.sku).toBe('SKU-100');
  });

  it('treats LIKE wildcards in operator input as literals', () => {
    const { db } = freshDb();
    seedProduct(db);
    const repo = new ProductRepository(db);

    // '%' alone would match everything if unescaped. The product name really
    // contains "50%", so searching for it must match — and searching for a
    // bare wildcard must not.
    expect(repo.search('50%')).toHaveLength(1);
    expect(repo.search('%%%%')).toHaveLength(0);
  });

  it('clamps an oversized limit', () => {
    const { db } = freshDb();
    seedProduct(db);
    expect(() => new ProductRepository(db).search('Cotton', 999_999)).not.toThrow();
  });
});
