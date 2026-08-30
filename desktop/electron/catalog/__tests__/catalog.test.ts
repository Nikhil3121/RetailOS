/**
 * Phase 2 catalog tests — against real SQLite, no mocks.
 *
 * The performance block seeds 10,000 products / 12,000 variants and measures
 * barcode lookup. Numbers are asserted loosely (a CI box is slower than a
 * counter PC) but the shape being verified is that lookup is index-bound and
 * does not degrade with catalog size.
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

import { closeDatabase, openDatabase } from '../../database/connection';
import { runMigrations } from '../../database/migrations';
import {
  CatalogRepository,
  type StagedProduct,
  type StagedVariant,
} from '../../database/repositories/catalog-repository';
import { toBasisPoints, toPaise, validateCatalog, type RawProduct } from '../catalog-validator';

function freshDb() {
  const file = path.join(tempDir, `cat-${randomUUID()}.db`);
  const db = openDatabase(file);
  runMigrations(db);
  return { db, file };
}

function product(over: Partial<StagedProduct> = {}): StagedProduct {
  return {
    serverProductId: randomUUID(),
    name: 'Cotton Shirt',
    description: null,
    hsnCode: '6205',
    taxRateBp: 500,
    categoryId: null,
    brandId: null,
    unitId: null,
    isActive: true,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function variant(serverProductId: string, over: Partial<StagedVariant> = {}): StagedVariant {
  return {
    serverVariantId: randomUUID(),
    serverProductId,
    name: 'M / Blue',
    sku: `SKU-${Math.random().toString(36).slice(2, 10)}`,
    barcode: null,
    attributes: null,
    mrpPaise: 99900,
    sellingPricePaise: 89900,
    costPricePaise: 50000,
    sortOrder: 0,
    isActive: true,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-cat-'));
});

afterEach(() => {
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the WAL briefly */
  }
});

describe('catalog repository', () => {
  it('inserts and finds by barcode', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();

    repo.replaceCatalog({
      products: [p],
      variants: [variant(p.serverProductId, { barcode: '8901234567890', sku: 'SKU-1' })],
      rejects: [],
      snapshotVersion: 'v1',
      storeId: null,
    });

    const found = repo.findByBarcode('8901234567890');
    expect(found?.sku).toBe('SKU-1');
    expect(found?.productName).toBe('Cotton Shirt');
    expect(found?.taxRateBp).toBe(500);
  });

  it('finds by SKU', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();
    repo.replaceCatalog({
      products: [p],
      variants: [variant(p.serverProductId, { sku: 'SKU-FALLBACK' })],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    expect(repo.findBySku('SKU-FALLBACK')).not.toBeNull();
  });

  it('prefers exact barcode over SKU in findByCode', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();
    // A code that is one variant's barcode AND another's SKU. The barcode
    // must win — that is what the scanner produced.
    repo.replaceCatalog({
      products: [p],
      variants: [
        variant(p.serverProductId, { barcode: 'COLLIDE', sku: 'SKU-A' }),
        variant(p.serverProductId, { sku: 'COLLIDE' }),
      ],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    expect(repo.findByCode('COLLIDE')?.sku).toBe('SKU-A');
  });

  it('excludes inactive variants and inactive products', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);

    const live = product();
    const dead = product({ isActive: false });
    repo.replaceCatalog({
      products: [live, dead],
      variants: [
        variant(live.serverProductId, { barcode: 'BC-INACTIVE-VARIANT', isActive: false }),
        variant(dead.serverProductId, { barcode: 'BC-INACTIVE-PRODUCT' }),
        variant(live.serverProductId, { barcode: 'BC-LIVE' }),
      ],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });

    expect(repo.findByBarcode('BC-INACTIVE-VARIANT')).toBeNull();
    expect(repo.findByBarcode('BC-INACTIVE-PRODUCT')).toBeNull();
    expect(repo.findByBarcode('BC-LIVE')).not.toBeNull();
  });

  it('ranks exact matches first in search', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product({ name: 'Cotton' });
    repo.replaceCatalog({
      products: [p],
      variants: [
        variant(p.serverProductId, { sku: 'COTTON-XL' }),
        variant(p.serverProductId, { sku: 'COTTON' }),
      ],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    expect(repo.search('COTTON')[0].sku).toBe('COTTON');
  });

  it('rejects a duplicate barcode at the schema level', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();
    expect(() =>
      repo.replaceCatalog({
        products: [p],
        variants: [
          variant(p.serverProductId, { barcode: 'DUP' }),
          variant(p.serverProductId, { barcode: 'DUP' }),
        ],
        rejects: [], snapshotVersion: 'v1', storeId: null,
      }),
    ).toThrow();
  });

  it('allows many variants with a NULL barcode (partial unique index)', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();
    expect(() =>
      repo.replaceCatalog({
        products: [p],
        variants: [
          variant(p.serverProductId, { barcode: null }),
          variant(p.serverProductId, { barcode: null }),
          variant(p.serverProductId, { barcode: null }),
        ],
        rejects: [], snapshotVersion: 'v1', storeId: null,
      }),
    ).not.toThrow();
  });
});

describe('catalog atomicity', () => {
  it('keeps the previous catalog when a replace fails', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);

    const good = product();
    repo.replaceCatalog({
      products: [good],
      variants: [variant(good.serverProductId, { barcode: 'ORIGINAL' })],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    expect(repo.counts().variants).toBe(1);

    // Second sync fails halfway on a duplicate barcode.
    const bad = product();
    expect(() =>
      repo.replaceCatalog({
        products: [bad],
        variants: [
          variant(bad.serverProductId, { barcode: 'NEW-1' }),
          variant(bad.serverProductId, { barcode: 'NEW-1' }),
        ],
        rejects: [], snapshotVersion: 'v2', storeId: null,
      }),
    ).toThrow();

    // The original catalog must be exactly as it was.
    expect(repo.counts().variants).toBe(1);
    expect(repo.findByBarcode('ORIGINAL')).not.toBeNull();
    expect(repo.findByBarcode('NEW-1')).toBeNull();
    expect(repo.getState().snapshotVersion).toBe('v1');
  });

  it('moves status to READY and records counts on success', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    expect(repo.getState().status).toBe('NOT_INITIALIZED');

    const p = product();
    repo.replaceCatalog({
      products: [p],
      variants: [variant(p.serverProductId)],
      rejects: [], snapshotVersion: 'v9', storeId: 'store-1',
    });

    const state = repo.getState();
    expect(state.status).toBe('READY');
    expect(state.productCount).toBe(1);
    expect(state.variantCount).toBe(1);
    expect(state.storeId).toBe('store-1');
    expect(state.lastSuccessfulSync).not.toBeNull();
  });

  it('handles an empty catalog without error', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const res = repo.replaceCatalog({
      products: [], variants: [], rejects: [], snapshotVersion: 'empty', storeId: null,
    });
    expect(res.products).toBe(0);
    expect(repo.getState().status).toBe('READY');
  });

  it('skips variants whose product was rejected', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    const p = product();
    const res = repo.replaceCatalog({
      products: [p],
      variants: [
        variant(p.serverProductId),
        variant('00000000-0000-0000-0000-000000000000'), // orphan
      ],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    expect(res.variants).toBe(1);
  });
});

describe('catalog validator', () => {
  const rawProduct = (over: Partial<RawProduct> = {}): RawProduct => ({
    id: randomUUID(),
    name: 'Silk Saree',
    hsn_code: '5007',
    tax_rate: '5',
    is_active: true,
    variants: [],
    ...over,
  });

  it('converts decimal rupees to integer paise', () => {
    expect(toPaise('199.50')).toBe(19950);
    expect(toPaise(0)).toBe(0);
    expect(toPaise('abc')).toBeNull();
    expect(toPaise(-5)).toBeNull();
    // Rounds rather than truncating — truncation loses money per line.
    expect(toPaise('10.005')).toBe(1001);
  });

  it('converts tax percentage to basis points', () => {
    expect(toBasisPoints('5')).toBe(500);
    expect(toBasisPoints('12.5')).toBe(1250);
    expect(toBasisPoints('101')).toBeNull();
    expect(toBasisPoints('nonsense')).toBeNull();
  });

  it('rejects a product with a missing or non-UUID id', () => {
    const out = validateCatalog([rawProduct({ id: 'not-a-uuid' })]);
    expect(out.products).toHaveLength(0);
    expect(out.rejects[0].reason).toMatch(/UUID/);
  });

  it('rejects a product with an invalid tax rate', () => {
    const out = validateCatalog([rawProduct({ tax_rate: 'banana' })]);
    expect(out.products).toHaveLength(0);
    expect(out.rejects[0].reason).toMatch(/tax_rate/);
  });

  it('rejects a variant with an invalid selling price', () => {
    const pid = randomUUID();
    const out = validateCatalog([
      rawProduct({
        id: pid,
        variants: [{ id: randomUUID(), sku: 'S1', selling_price: 'free' }],
      }),
    ]);
    expect(out.products).toHaveLength(1);   // product itself is fine
    expect(out.variants).toHaveLength(0);
    expect(out.rejects[0].reason).toMatch(/selling_price/);
  });

  it('quarantines a duplicate barcode, first wins', () => {
    const pid = randomUUID();
    const out = validateCatalog([
      rawProduct({
        id: pid,
        variants: [
          { id: randomUUID(), sku: 'A', barcode: 'SAME', selling_price: '10' },
          { id: randomUUID(), sku: 'B', barcode: 'SAME', selling_price: '20' },
        ],
      }),
    ]);
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0].sku).toBe('A');
    expect(out.rejects[0].reason).toMatch(/duplicate barcode/);
  });

  it('rejects a barcode containing whitespace', () => {
    const pid = randomUUID();
    const out = validateCatalog([
      rawProduct({
        id: pid,
        variants: [{ id: randomUUID(), sku: 'A', barcode: '890 123', selling_price: '10' }],
      }),
    ]);
    expect(out.variants).toHaveLength(0);
    expect(out.rejects[0].reason).toMatch(/whitespace/);
  });

  it('treats a null barcode as valid', () => {
    const pid = randomUUID();
    const out = validateCatalog([
      rawProduct({
        id: pid,
        variants: [{ id: randomUUID(), sku: 'A', barcode: null, selling_price: '10' }],
      }),
    ]);
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0].barcode).toBeNull();
  });

  it('falls back to selling price when MRP is absent', () => {
    const pid = randomUUID();
    const out = validateCatalog([
      rawProduct({
        id: pid,
        variants: [{ id: randomUUID(), sku: 'A', selling_price: '250' }],
      }),
    ]);
    expect(out.variants[0].mrpPaise).toBe(25000);
  });
});

describe('offline startup scenarios', () => {
  it('Scenario B — existing catalog survives a restart with no network', () => {
    const { db, file } = freshDb();
    const p = product();
    new CatalogRepository(db).replaceCatalog({
      products: [p],
      variants: [variant(p.serverProductId, { barcode: 'OFFLINE-OK' })],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });
    closeDatabase();

    // Reopen — no network involved anywhere in this path.
    const reopened = openDatabase(file);
    runMigrations(reopened);
    const repo = new CatalogRepository(reopened);

    expect(repo.getState().status).toBe('READY');
    expect(repo.findByBarcode('OFFLINE-OK')).not.toBeNull();
  });

  it('Scenario C — no catalog reports NOT_INITIALIZED, not a false READY', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);
    expect(repo.getState().status).toBe('NOT_INITIALIZED');
    expect(repo.getState().variantCount).toBe(0);
    expect(repo.findByBarcode('anything')).toBeNull();
  });
});

describe('barcode lookup performance', () => {
  it('stays fast with 10,000 products / 12,000 variants', () => {
    const { db } = freshDb();
    const repo = new CatalogRepository(db);

    const PRODUCTS = 10_000;
    const products: StagedProduct[] = [];
    const variants: StagedVariant[] = [];

    for (let i = 0; i < PRODUCTS; i++) {
      const p = product({ name: `Product ${i}` });
      products.push(p);
      variants.push(variant(p.serverProductId, {
        barcode: `890${String(i).padStart(10, '0')}`,
        sku: `SKU-${i}`,
      }));
      // Every fifth product gets a second variant -> 12,000 total.
      if (i % 5 === 0) {
        variants.push(variant(p.serverProductId, {
          barcode: `891${String(i).padStart(10, '0')}`,
          sku: `SKU-${i}-B`,
        }));
      }
    }

    const insertStart = Date.now();
    const res = repo.replaceCatalog({
      products, variants, rejects: [], snapshotVersion: 'perf', storeId: null,
    });
    const insertMs = Date.now() - insertStart;

    expect(res.products).toBe(PRODUCTS);
    expect(res.variants).toBe(12_000);

    // 1,000 lookups spread across the catalog, so caching one hot row cannot
    // flatter the result.
    const LOOKUPS = 1000;
    const codes = Array.from({ length: LOOKUPS }, (_, i) =>
      `890${String(Math.floor((i * PRODUCTS) / LOOKUPS)).padStart(10, '0')}`,
    );

    const start = process.hrtime.bigint();
    let hits = 0;
    for (const code of codes) {
      if (repo.findByBarcode(code)) hits += 1;
    }
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
    const perLookupMs = totalMs / LOOKUPS;

    // eslint-disable-next-line no-console
    console.log(
      `[perf] insert ${PRODUCTS}p/12000v: ${insertMs}ms | ` +
      `${LOOKUPS} barcode lookups: ${totalMs.toFixed(1)}ms total, ` +
      `${perLookupMs.toFixed(4)}ms each`,
    );

    expect(hits).toBe(LOOKUPS);
    // Generous ceiling — a counter PC is far faster than CI, and the point is
    // to catch an accidental full scan, not to police microseconds.
    expect(perLookupMs).toBeLessThan(2);
  }, 120_000);

  it('uses the barcode index rather than scanning', () => {
    const { db } = freshDb();
    const p = product();
    new CatalogRepository(db).replaceCatalog({
      products: [p],
      variants: [variant(p.serverProductId, { barcode: 'PLAN-CHECK' })],
      rejects: [], snapshotVersion: 'v1', storeId: null,
    });

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT v.id FROM product_variant v JOIN product p ON p.id = v.product_id
          WHERE v.barcode = ? AND v.is_active = 1 AND p.is_active = 1`,
      )
      .all('PLAN-CHECK') as { detail: string }[];

    const detail = plan.map((r) => r.detail).join(' ');
    expect(detail).toMatch(/idx_variant_barcode/);
    expect(detail).not.toMatch(/SCAN product_variant/);
  });
});
