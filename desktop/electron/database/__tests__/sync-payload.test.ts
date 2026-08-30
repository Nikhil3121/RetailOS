/**
 * Phase 5 preparation — proves the sale now carries everything a future sync
 * needs, and that adding those columns did not disturb anything already
 * stored.
 *
 * The restart tests close the connection and reopen the file rather than
 * asserting against an in-memory object. A field that is only correct while
 * the process is alive is not preserved — it is cached.
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

/** Derived from the manifest so appending a migration cannot break these. */
const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));
import { DeviceRepository } from '../repositories/device-repository';
import { SaleRepository, type SaleInput } from '../repositories/sale-repository';

const VARIANT = '44444444-4444-4444-8444-444444444444';
const SALESPERSON = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';

function freshDb(file?: string, upTo?: number) {
  const target = file ?? path.join(tempDir, `sync-${randomUUID()}.db`);
  const db = openDatabase(target);
  runMigrations(db, upTo ? MIGRATIONS.filter((m) => m.version <= upTo) : MIGRATIONS);
  new DeviceRepository(db).getOrCreate();
  return { db, file: target };
}

/** A realistic line, modelled on the physical label the shop actually uses:
 *  SHORT KURTI — MRP 343, MS price 240, 30% off. Barcode and SKU are separate
 *  facts and are NOT the same value. */
const sale = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  serverStoreId: '33333333-3333-4333-8333-333333333333',
  serverCustomerId: CUSTOMER,
  serverSalespersonUserId: SALESPERSON,
  items: [
    {
      productId: null,
      serverVariantId: VARIANT,
      productName: 'SHORT KURTI 660',
      sku: '160055.003',
      hsnCode: '6211',
      quantity: 1,
      mrpPaise: 34300,
      unitPricePaise: 34300,
      discountPctBp: 3000,
      discountPaise: 10290,
      taxRateBp: 500,
      taxPaise: 1143,
      lineTotalPaise: 24010,
    },
  ],
  payments: [{ method: 'upi', amountPaise: 24000, reference: 'UPI-TXN-9931' }],
  ...over,
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-sync-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

/** Commit a sale, then genuinely close and reopen the file. */
function afterRestart(input: SaleInput = sale()) {
  const { db, file } = freshDb();
  const id = new SaleRepository(db).create(input);
  closeDatabase();

  const reopened = openDatabase(file);
  runMigrations(reopened);
  return { record: new SaleRepository(reopened).get(id), id, db: reopened };
}

describe('the sync payload survives a restart', () => {
  it('keeps server_variant_id — without it the sale can never be pushed', () => {
    const { record } = afterRestart();
    expect(record?.items[0].serverVariantId).toBe(VARIANT);
  });

  it('keeps the discount percentage exactly as entered, not re-derived', () => {
    const { record } = afterRestart();
    // 30%, not 29.99% recovered by dividing the amount by the gross.
    expect(record?.items[0].discountPctBp).toBe(3000);
    // The resulting amount is kept alongside it, not instead of it.
    expect(record?.items[0].discountPaise).toBe(10290);
  });

  it('keeps the tax snapshot taken at sale time', () => {
    const { record } = afterRestart();
    expect(record?.items[0].taxRateBp).toBe(500);
    expect(record?.items[0].taxPaise).toBe(1143);
    expect(record?.taxPaise).toBe(1143);
  });

  it('keeps the payment reference', () => {
    const { record } = afterRestart();
    expect(record?.payments[0].reference).toBe('UPI-TXN-9931');
    expect(record?.payments[0].method).toBe('upi');
  });

  it('keeps MRP and HSN, which the printed bill must show', () => {
    const { record } = afterRestart();
    expect(record?.items[0].mrpPaise).toBe(34300);
    expect(record?.items[0].hsnCode).toBe('6211');
  });

  it('keeps the salesperson and customer attribution', () => {
    const { record } = afterRestart();
    expect(record?.serverSalespersonUserId).toBe(SALESPERSON);
    expect(record?.serverCustomerId).toBe(CUSTOMER);
  });

  it('preserves SKU and barcode as separate facts — SKU is not the barcode', () => {
    const { record } = afterRestart();
    // The label's printed code. Nothing in the sale claims this is a barcode.
    expect(record?.items[0].sku).toBe('160055.003');
    expect(record?.items[0].productName).toBe('SHORT KURTI 660');
  });

  it('carries every field POST /sales needs for lines[]', () => {
    const { record } = afterRestart();
    const line = record?.items[0];
    // variant_id, quantity, unit_price, discount_pct — the whole SaleLineInput.
    expect(line?.serverVariantId).toBeTruthy();
    expect(line?.quantity).toBe(1);
    expect(line?.unitPricePaise).toBeGreaterThan(0);
    expect(line?.discountPctBp).toBeGreaterThanOrEqual(0);
    // ...and the sale-level fields.
    expect(record?.serverStoreId).toBeTruthy();
    expect(record?.id).toBeTruthy(); // client_uuid
  });
});

describe('client_uuid is stable', () => {
  it('sale.id IS the client uuid and is never regenerated on read or restart', () => {
    const clientUuid = randomUUID();
    const { record, id } = afterRestart(sale({ id: clientUuid }));

    expect(id).toBe(clientUuid);
    expect(record?.id).toBe(clientUuid);
  });

  it('a retry cannot mint a second sale under the same key', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    const clientUuid = randomUUID();

    repo.create(sale({ id: clientUuid }));
    expect(() => repo.create(sale({ id: clientUuid }))).toThrow();
    expect(repo.count()).toBe(1);
  });
});

describe('migration 005 does not disturb existing data', () => {
  /** Write a sale using ONLY the columns that existed at version 4. */
  function legacySale(db: ReturnType<typeof openDatabase>, id: string) {
    db.prepare(
      `INSERT INTO sale (id, status, subtotal_paise, discount_paise, tax_paise,
         total_paise, notes, local_reference, server_store_id,
         created_at, updated_at, sync_status)
       VALUES (?, 'COMPLETED', 85619, 0, 4281, 89900, 'legacy',
               'OFFLINE-LEGACY-000001', '33333333-3333-4333-8333-333333333333',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'PENDING')`,
    ).run(id);
    db.prepare(
      `INSERT INTO sale_item (id, sale_id, product_name, sku, quantity,
         unit_price_paise, discount_paise, tax_rate_bp, tax_paise,
         line_total_paise, line_no)
       VALUES (?, ?, 'Old Shirt', 'OLD-1', 2, 44950, 0, 500, 4281, 89900, 1)`,
    ).run(randomUUID(), id);
    db.prepare(
      `INSERT INTO payment (id, sale_id, method, amount_paise, reference, created_at)
       VALUES (?, ?, 'cash', 89900, NULL, '2026-01-01T00:00:00.000Z')`,
    ).run(randomUUID(), id);
  }

  it('a sale written before 005 is still readable after it', () => {
    const { db, file } = freshDb(undefined, 4);
    const id = randomUUID();
    legacySale(db, id);
    expect(currentSchemaVersion(db)).toBe(4);
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened); // applies 005 and everything after it
    expect(currentSchemaVersion(reopened)).toBe(LATEST);

    const record = new SaleRepository(reopened).get(id);
    expect(record).not.toBeNull();
    expect(record?.items).toHaveLength(1);
    expect(record?.payments).toHaveLength(1);
  });

  it('no financial value changes when 005 is applied', () => {
    const { db, file } = freshDb(undefined, 4);
    const id = randomUUID();
    legacySale(db, id);
    const before = db
      .prepare('SELECT subtotal_paise, discount_paise, tax_paise, total_paise FROM sale WHERE id = ?')
      .get(id);
    const lineBefore = db
      .prepare('SELECT unit_price_paise, discount_paise, tax_rate_bp, tax_paise, line_total_paise, quantity FROM sale_item WHERE sale_id = ?')
      .get(id);
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);

    expect(
      reopened
        .prepare('SELECT subtotal_paise, discount_paise, tax_paise, total_paise FROM sale WHERE id = ?')
        .get(id),
    ).toEqual(before);
    expect(
      reopened
        .prepare('SELECT unit_price_paise, discount_paise, tax_rate_bp, tax_paise, line_total_paise, quantity FROM sale_item WHERE sale_id = ?')
        .get(id),
    ).toEqual(lineBefore);
  });

  it('back-fills the new columns with neutral defaults, not guesses', () => {
    const { db, file } = freshDb(undefined, 4);
    const id = randomUUID();
    legacySale(db, id);
    closeDatabase();

    const reopened = openDatabase(file);
    runMigrations(reopened);
    const line = new SaleRepository(reopened).get(id)?.items[0];

    // Unknown is recorded as unknown. A legacy line has no variant id, and
    // inventing one from the SKU would be a fabricated financial record.
    expect(line?.serverVariantId).toBeNull();
    expect(line?.hsnCode).toBeNull();
    expect(line?.mrpPaise).toBe(0);
    expect(line?.discountPctBp).toBe(0);
  });

  it('is idempotent — running it again applies nothing', () => {
    const { db } = freshDb();
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain(5);
    expect(currentSchemaVersion(db)).toBe(LATEST);
  });

  it('rolls back completely when a migration throws', () => {
    const { db } = freshDb(undefined, 4);
    expect(currentSchemaVersion(db)).toBe(4);

    const broken = [
      ...MIGRATIONS.filter((m) => m.version <= 4),
      {
        version: 99,
        name: 'deliberately-broken',
        up: (d: typeof db) => {
          d.exec('ALTER TABLE sale ADD COLUMN half_applied TEXT;');
          throw new Error('boom');
        },
      },
    ];

    expect(() => runMigrations(db, broken)).toThrow('boom');
    // The schema must be exactly where it was — no half-applied column, no
    // recorded version.
    expect(currentSchemaVersion(db)).toBe(4);
    const cols = (db.prepare('PRAGMA table_info(sale)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).not.toContain('half_applied');
  });
});

describe('checkout has not regressed', () => {
  it('still writes sale, items, payment and sync_queue in one transaction', () => {
    const { db } = freshDb();
    const id = new SaleRepository(db).create(sale());

    for (const [table, col] of [
      ['sale', 'id'],
      ['sale_item', 'sale_id'],
      ['payment', 'sale_id'],
      ['sync_queue', 'entity_id'],
    ] as const) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`)
        .get(id) as { n: number };
      expect(row.n).toBe(1);
    }
  });

  it('a line with no variant id is still accepted and still rolls back on error', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);

    // Optional field omitted entirely — the pre-005 caller shape.
    const minimal = sale({
      items: [
        {
          productId: null,
          productName: 'No Variant',
          quantity: 1,
          unitPricePaise: 10000,
          lineTotalPaise: 10000,
        },
      ],
    });
    expect(() => repo.create(minimal)).not.toThrow();

    expect(() =>
      repo.create(sale({ items: [{ ...sale().items[0], productName: null as unknown as string }] })),
    ).toThrow();
    expect(repo.count()).toBe(1);
  });

  it('the offline reference is unchanged in shape', () => {
    const { db } = freshDb();
    const repo = new SaleRepository(db);
    expect(repo.get(repo.create(sale()))?.localReference).toMatch(/^OFFLINE-[A-Z0-9]{1,6}-\d{6}$/);
  });
});
