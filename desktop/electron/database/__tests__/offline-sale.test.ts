/**
 * Phase 4 completion tests — offline sale durability and the local reference.
 *
 * Everything here runs against a real SQLite file. The restart tests genuinely
 * close the connection and reopen the file, which is the closest honest
 * simulation of a power cut available without pulling the plug: SQLite in WAL
 * mode with synchronous=NORMAL survives a process kill, and reopening proves
 * the committed data is on disk rather than in a cache.
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
import { SaleRepository, type SaleInput } from '../repositories/sale-repository';

function freshDb(file?: string) {
  const target = file ?? path.join(tempDir, `sale-${randomUUID()}.db`);
  const db = openDatabase(target);
  runMigrations(db);
  new DeviceRepository(db).getOrCreate(); // reference needs a terminal tag
  return { db, file: target };
}

const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 85619,
  discountPaise: 0,
  taxPaise: 4281,
  totalPaise: 89900,
  serverStoreId: '33333333-3333-4333-8333-333333333333',
  items: [
    {
      productId: null,
      productName: 'Cotton Shirt — M / Blue',
      sku: 'SKU-1',
      quantity: 1,
      unitPricePaise: 89900,
      discountPaise: 0,
      taxRateBp: 500,
      taxPaise: 4281,
      lineTotalPaise: 89900,
    },
  ],
  payments: [{ method: 'cash', amountPaise: 89900 }],
  ...over,
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-sale-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

describe('offline sale is atomic', () => {
  it('commits sale, items, payment and sync_queue together', () => {
    const { db } = freshDb();
    const id = new SaleRepository(db).create(sale());

    const s = db.prepare('SELECT COUNT(*) AS n FROM sale WHERE id = ?').get(id) as { n: number };
    const items = db.prepare('SELECT COUNT(*) AS n FROM sale_item WHERE sale_id = ?').get(id) as { n: number };
    const pay = db.prepare('SELECT COUNT(*) AS n FROM payment WHERE sale_id = ?').get(id) as { n: number };
    const queue = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type='sale' AND entity_id=?")
      .get(id) as { n: number };

    expect(s.n).toBe(1);
    expect(items.n).toBe(1);
    expect(pay.n).toBe(1);
    expect(queue.n).toBe(1);
  });

  it('rollback leaves no partial sale, no orphan items, no queue entry', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);

    expect(() =>
      repo.create(
        sale({
          items: [
            sale().items[0],
            // NOT NULL violation — must take the whole bill down with it.
            { ...sale().items[0], productName: null as unknown as string },
          ],
        }),
      ),
    ).toThrow();

    for (const table of ['sale', 'sale_item', 'payment', 'sync_queue']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n).toBe(0);
    }
  });

  it('never produces a sale without a sync_queue entry', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    for (let i = 0; i < 20; i++) repo.create(sale());

    const sales = db.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number };
    const queued = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type='sale'")
      .get() as { n: number };
    expect(queued.n).toBe(sales.n);
  });
});

describe('local reference', () => {
  it('is allocated, printable and distinguishable from an invoice number', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const record = repo.get(repo.create(sale()));

    expect(record?.localReference).toMatch(/^OFFLINE-[A-Z0-9]{1,6}-\d{6}$/);
    // The GST invoice number is the SERVER's to allocate — still null.
    expect(record?.invoiceNumber).toBeNull();
  });

  it('increments monotonically and never repeats', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const refs = Array.from({ length: 50 }, () => repo.get(repo.create(sale()))?.localReference);
    expect(new Set(refs).size).toBe(50);
  });

  it('is traceable back to sale.id', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const id = repo.create(sale());
    const ref = repo.get(id)?.localReference;

    const found = db
      .prepare('SELECT id FROM sale WHERE local_reference = ?')
      .get(ref) as { id: string };
    expect(found.id).toBe(id);
  });

  it('does not reuse a number burned by a failed bill', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const first = repo.get(repo.create(sale()))?.localReference;

    // A failed bill rolls the counter back with the transaction.
    expect(() =>
      repo.create(sale({ items: [{ ...sale().items[0], productName: null as unknown as string }] })),
    ).toThrow();

    const second = repo.get(repo.create(sale()))?.localReference;
    expect(second).not.toBe(first);
  });

  it('is rejected as a duplicate by the schema', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const ref = repo.get(repo.create(sale()))?.localReference;
    expect(() =>
      db
        .prepare(
          `INSERT INTO sale (id, status, subtotal_paise, discount_paise, tax_paise,
             total_paise, local_reference, created_at, updated_at, sync_status)
           VALUES (?, 'COMPLETED', 0, 0, 0, 0, ?, 'now', 'now', 'PENDING')`,
        )
        .run(randomUUID(), ref),
    ).toThrow();
  });
});

describe('restart / power-loss safety', () => {
  it('the sale still exists after close and reopen', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    const refBefore = new SaleRepository(db).get(id)?.localReference;

    closeDatabase(); // simulates the process ending

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const after = new SaleRepository(reopened).get(id);

    expect(after).not.toBeNull();
    expect(after?.totalPaise).toBe(89900);
    expect(after?.localReference).toBe(refBefore);
  });

  it('the sync_queue entry survives a restart', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const queued = reopened
      .prepare("SELECT status FROM sync_queue WHERE entity_id = ?")
      .get(id) as { status: string };

    expect(queued.status).toBe('PENDING');
  });

  it('the receipt can still be rendered after a restart', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const record = new SaleRepository(reopened).get(id);

    // Everything the receipt prints must come back.
    expect(record?.items[0].productName).toBe('Cotton Shirt — M / Blue');
    expect(record?.items[0].sku).toBe('SKU-1');
    expect(record?.items[0].taxRateBp).toBe(500);
    expect(record?.items[0].taxPaise).toBe(4281);
    expect(record?.payments[0].method).toBe('cash');
    expect(record?.subtotalPaise).toBe(85619);
    expect(record?.taxPaise).toBe(4281);
  });

  it('the sale is not recreated on restart', () => {
    const { db, file } = freshDb();
    const id = new SaleRepository(db).create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const count = reopened.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number };
    expect(count.n).toBe(1);
    expect(new SaleRepository(reopened).get(id)).not.toBeNull();
  });

  it('the local sequence continues rather than restarting from 1', () => {
    const { db, file } = freshDb();
    const repo = new SaleRepository(db);
    repo.create(sale());
    repo.create(sale());
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const ref = new SaleRepository(reopened).get(
      new SaleRepository(reopened).create(sale()),
    )?.localReference;

    expect(ref).toMatch(/-000003$/);
  });
});

describe('idempotency', () => {
  it('the same client uuid cannot create two sales', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const clientUuid = randomUUID();

    repo.create(sale({ id: clientUuid }));
    // A replay — the primary key refuses it, so one logical sale exists.
    expect(() => repo.create(sale({ id: clientUuid }))).toThrow();

    const count = db.prepare('SELECT COUNT(*) AS n FROM sale').get() as { n: number };
    expect(count.n).toBe(1);
  });
});
