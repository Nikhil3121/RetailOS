/**
 * Phase 5 — the worker end to end, against a real SQLite file and a fake
 * server.
 *
 * `fetch` is stubbed rather than the service being restructured for testing:
 * every other layer — claiming, payload building, classification, outcome
 * recording, crash recovery — is the real code path. The fake server also
 * models the ONE behaviour everything depends on: idempotency on client_uuid.
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

vi.mock('../../pos-config', () => ({
  getPosConfig: () => ({ apiBaseUrl: 'http://test.invalid', environment: 'development' }),
}));

// The service resolves its repositories through the database service
// singleton. Pointing that at the test database exercises the real
// repositories rather than a stand-in.
let db: import('../../database/connection').Db;
vi.mock('../../database/database-service', () => ({
  databaseService: {
    isReady: () => true,
    syncs: () => new SyncRepositoryRef.current(db),
    sales: () => new SaleRepositoryRef.current(db),
  },
}));

import { closeDatabase, openDatabase } from '../../database/connection';
import { runMigrations } from '../../database/migrations';
import { DeviceRepository } from '../../database/repositories/device-repository';
import { SaleRepository, type SaleInput } from '../../database/repositories/sale-repository';
import { SyncRepository } from '../../database/repositories/sync-repository';
import { saleSyncService } from '../sale-sync-service';

const SyncRepositoryRef = { current: SyncRepository };
const SaleRepositoryRef = { current: SaleRepository };

const STORE = '33333333-3333-4333-8333-333333333333';
const VARIANT = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'test-token';

const SESSION = '88888888-8888-4888-8888-888888888888';
const DEVICE = '99999999-9999-4999-8999-999999999999';

const saleInput = (over: Partial<SaleInput> = {}): SaleInput => ({
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  serverStoreId: STORE,
  serverDaySessionId: SESSION,
  terminalUuid: DEVICE,
  occurredAt: '2026-03-31T18:05:00.000Z',
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

/** Minimal SaleRead. `tax_total` mirrors the local snapshot unless overridden. */
function saleRead(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    number: 'INV-2026-0007',
    store_id: STORE,
    tax_total: '11.43',
    grand_total: '240.00',
    ...over,
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function errorEnvelope(code: string) {
  return { error: { code, message: `${code} happened`, details: {} } };
}

/**
 * A fake FastAPI that implements the real idempotency rule: a client_uuid it
 * has already stored returns the EXISTING sale instead of creating a second.
 */
function fakeServer() {
  const byClientUuid = new Map<string, ReturnType<typeof saleRead>>();
  const requests: { client_uuid: string; body: Record<string, unknown> }[] = [];

  const handler = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const clientUuid = String(body.client_uuid);
    requests.push({ client_uuid: clientUuid, body });

    const existing = byClientUuid.get(clientUuid);
    if (existing) return jsonResponse(201, existing);

    const created = saleRead();
    byClientUuid.set(clientUuid, created);
    return jsonResponse(201, created);
  });

  return { handler, requests, created: byClientUuid };
}

function freshDb() {
  const file = path.join(tempDir, `sync-${randomUUID()}.db`);
  db = openDatabase(file);
  runMigrations(db);
  new DeviceRepository(db).getOrCreate();
  return file;
}

function queueRowFor(saleId: string) {
  return db
    .prepare('SELECT * FROM sync_queue WHERE entity_id = ?')
    .get(saleId) as Record<string, unknown>;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-p5-'));
  freshDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  closeDatabase();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the WAL briefly */
  }
});

describe('successful synchronisation', () => {
  it('claims, pushes and marks the entry SYNCED', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(1);
    expect(result.synced).toBe(1);
    expect(queueRowFor(saleId).status).toBe('SYNCED');
  });

  it('records server id, invoice number and sync time for reconciliation', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const saleId = new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });

    const sale = new SaleRepository(db).get(saleId);
    expect(sale?.serverId).toBe(server.created.get(saleId)?.id);
    expect(sale?.invoiceNumber).toBe('INV-2026-0007');
    expect(sale?.syncStatus).toBe('SYNCED');
    expect(
      (db.prepare('SELECT synced_at FROM sale WHERE id = ?').get(saleId) as { synced_at: string })
        .synced_at,
    ).toBeTruthy();
  });

  it('sends the client uuid as the sale id and never a fresh one', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const saleId = new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });

    expect(server.requests[0].client_uuid).toBe(saleId);
  });

  it('sends the variant id, exact money and persisted discount', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });

    const lines = server.requests[0].body.lines as Record<string, string>[];
    expect(lines[0]).toEqual({
      variant_id: VARIANT,
      quantity: '1.000',
      unit_price: '343.00',
      discount_pct: '30.00',
      line_total: '240.10',
      tax_rate: '5.00',
    });
    const payments = server.requests[0].body.payments as Record<string, string>[];
    expect(payments[0].reference).toBe('UPI-TXN-9931');
  });

  it('never rewrites the local receipt or its reference', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const repo = new SaleRepository(db);
    const saleId = repo.create(saleInput());
    const before = repo.get(saleId);

    await saleSyncService.run({ accessToken: TOKEN });
    const after = repo.get(saleId);

    expect(after?.localReference).toBe(before?.localReference);
    expect(after?.subtotalPaise).toBe(before?.subtotalPaise);
    expect(after?.discountPaise).toBe(before?.discountPaise);
    expect(after?.taxPaise).toBe(before?.taxPaise);
    expect(after?.totalPaise).toBe(before?.totalPaise);
    expect(after?.items[0].taxPaise).toBe(before?.items[0].taxPaise);
  });
});

describe('attribution is pushed exactly as committed', () => {
  it('sends the sale-time session, occurrence time and terminal', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });

    const body = server.requests[0].body;
    expect(body.day_session_id).toBe(SESSION);
    expect(body.occurred_at).toBe('2026-03-31T18:05:00.000Z');
    expect(body.terminal_uuid).toBe(DEVICE);
  });

  it('never substitutes a different session at push time', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    // Two sales from two different shifts, drained in one run. If the worker
    // resolved "the current session" instead of reading each snapshot, both
    // would be pushed under the same id.
    const repo = new SaleRepository(db);
    repo.create(saleInput());
    repo.create(saleInput({ serverDaySessionId: 'cccccccc-3333-4333-8333-cccccccccccc' }));
    await saleSyncService.run({ accessToken: TOKEN });

    const sessions = server.requests.map((r) => r.body.day_session_id);
    expect(new Set(sessions).size).toBe(2);
  });

  it('pushes nulls for a pre-007 sale rather than inventing attribution', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    new SaleRepository(db).create(
      saleInput({ serverDaySessionId: null, terminalUuid: null }),
    );
    await saleSyncService.run({ accessToken: TOKEN });

    expect(server.requests[0].body.day_session_id).toBeNull();
    expect(server.requests[0].body.terminal_uuid).toBeNull();
  });

  it('treats a rejected session as permanent, never retargeting the sale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, errorEnvelope('DAY_SESSION_NOT_FOUND'))),
    );
    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.permanent).toBe(1);
    const row = queueRowFor(saleId);
    expect(row.status).toBe('FAILED');
    expect(row.failure_kind).toBe('PERMANENT');
    // The stored attribution is untouched — a human decides, not the worker.
    expect(new SaleRepository(db).get(saleId)?.serverDaySessionId).toBe(SESSION);
  });

  it('treats a store/session mismatch as permanent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(422, errorEnvelope('DAY_SESSION_STORE_MISMATCH'))),
    );
    new SaleRepository(db).create(saleInput());
    expect((await saleSyncService.run({ accessToken: TOKEN })).permanent).toBe(1);
  });
});

describe('tax divergence is observed, never applied', () => {
  it('stores the server figure alongside and flags the mismatch', async () => {
    // The server recomputed GST from a CHANGED product.tax_rate.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(201, saleRead({ tax_total: '20.00', grand_total: '250.00' }))),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.divergent).toBe(1);
    expect(result.synced).toBe(1); // it DID sync — it is flagged, not rejected

    const row = db
      .prepare('SELECT tax_paise, server_tax_paise, total_paise, server_total_paise FROM sale WHERE id = ?')
      .get(saleId) as Record<string, number>;

    // Local is untouched; the server's number sits beside it.
    expect(row.tax_paise).toBe(1143);
    expect(row.server_tax_paise).toBe(2000);
    expect(row.total_paise).toBe(24000);
    expect(row.server_total_paise).toBe(25000);

    const divergent = new SaleRepository(db).divergentSales();
    expect(divergent).toHaveLength(1);
    expect(divergent[0].id).toBe(saleId);
  });

  it('flags a GRAND TOTAL divergence, not only a tax one', async () => {
    // The rounded-shelf-price case, proven against the real backend in the
    // integration harness: the label says 240, but MRP 343 less 30% is
    // 240.10, and SaleLineInput has no field to pin the charged total.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(201, saleRead({ grand_total: '240.10' }))),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.divergent).toBe(1);
    const row = db
      .prepare('SELECT total_paise, server_total_paise FROM sale WHERE id = ?')
      .get(saleId) as Record<string, number>;

    // What the customer paid is untouched; the server's figure sits beside it.
    expect(row.total_paise).toBe(24000);
    expect(row.server_total_paise).toBe(24010);
    expect(new SaleRepository(db).divergentSales()).toHaveLength(1);
  });

  it('reports no divergence when the figures agree', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(201, saleRead())));
    new SaleRepository(db).create(saleInput());

    const result = await saleSyncService.run({ accessToken: TOKEN });
    expect(result.divergent).toBe(0);
    expect(new SaleRepository(db).divergentSales()).toHaveLength(0);
  });
});

describe('day session blocking', () => {
  it('classifies NO_OPEN_DAY_SESSION as blocked and keeps the sale alive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, errorEnvelope('NO_OPEN_DAY_SESSION'))),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.blocked).toBe(1);

    const row = queueRowFor(saleId);
    expect(row.status).toBe('PENDING'); // retryable later, not dead
    expect(row.failure_kind).toBe('BLOCKED');
    // A blocked bill must NOT burn attempts, or it would eventually exhaust.
    expect(row.attempt_count).toBe(0);
    expect(row.next_attempt_at).toBeTruthy();

    // The sale itself remains fully intact and printable.
    const sale = new SaleRepository(db).get(saleId);
    expect(sale?.totalPaise).toBe(24000);
    expect(sale?.localReference).toBeTruthy();
  });

  it('syncs successfully once a session is opened', async () => {
    let sessionOpen = false;
    const server = fakeServer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!sessionOpen) return jsonResponse(409, errorEnvelope('NO_OPEN_DAY_SESSION'));
        return server.handler(url, init);
      }),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });
    expect(queueRowFor(saleId).failure_kind).toBe('BLOCKED');

    // The operator opens the till. The blocked row is due in 15 minutes, so
    // make it due now — this tests recovery, not the clock.
    sessionOpen = true;
    db.prepare("UPDATE sync_queue SET next_attempt_at = '2000-01-01T00:00:00.000Z'").run();

    const second = await saleSyncService.run({ accessToken: TOKEN });
    expect(second.synced).toBe(1);
    expect(queueRowFor(saleId).status).toBe('SYNCED');
  });
});

describe('failure classification drives queue state', () => {
  it('retries a 5xx with backoff and keeps the row pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, null)));

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.retryable).toBe(1);
    const row = queueRowFor(saleId);
    expect(row.status).toBe('PENDING');
    expect(row.failure_kind).toBe('RETRYABLE');
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at).toBeTruthy();
  });

  it('retries a network drop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.retryable).toBe(1);
    expect(queueRowFor(saleId).status).toBe('PENDING');
    expect(String(queueRowFor(saleId).error)).toContain('NETWORK');
  });

  it('retries a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        throw e;
      }),
    );

    new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });
    expect(result.retryable).toBe(1);
  });

  it('stops permanently on VARIANT_NOT_FOUND without deleting the entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, errorEnvelope('VARIANT_NOT_FOUND'))),
    );

    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.permanent).toBe(1);
    const row = queueRowFor(saleId);
    expect(row.status).toBe('FAILED');
    expect(row.failure_kind).toBe('PERMANENT');
    expect(row.next_attempt_at).toBeNull();
    // The evidence is kept. The sale is still readable and printable.
    expect(new SaleRepository(db).get(saleId)).not.toBeNull();
  });

  it('stops permanently on a 422 validation rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(422, errorEnvelope('VALIDATION_ERROR'))),
    );
    new SaleRepository(db).create(saleInput());
    expect((await saleSyncService.run({ accessToken: TOKEN })).permanent).toBe(1);
  });

  it('does not permanently fail an expired token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, errorEnvelope('AUTHENTICATION_REQUIRED'))),
    );
    const saleId = new SaleRepository(db).create(saleInput());
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.retryable).toBe(1);
    expect(queueRowFor(saleId).status).toBe('PENDING');
  });

  it('refuses to push a sale with no variant id, permanently and locally', async () => {
    const called = vi.fn(async () => jsonResponse(201, saleRead()));
    vi.stubGlobal('fetch', called);

    const saleId = new SaleRepository(db).create(
      saleInput({ items: [{ ...saleInput().items[0], serverVariantId: null }] }),
    );
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.permanent).toBe(1);
    // Never reached the wire — the payload could not be built honestly.
    expect(called).not.toHaveBeenCalled();
    expect(queueRowFor(saleId).failure_kind).toBe('PERMANENT');
    expect(String(queueRowFor(saleId).error)).toContain('variant id');
  });

  it('every entry ends in a known state — nothing is silently dropped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, null)));
    const repo = new SaleRepository(db);
    for (let i = 0; i < 5; i++) repo.create(saleInput());

    await saleSyncService.run({ accessToken: TOKEN });

    const rows = db.prepare('SELECT status, failure_kind FROM sync_queue').all() as {
      status: string;
      failure_kind: string | null;
    }[];
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(['PENDING', 'FAILED', 'SYNCED']).toContain(r.status);
      expect(r.failure_kind).toBe('RETRYABLE');
    }
  });
});

describe('idempotency and crash recovery', () => {
  it('a lost response does not create a second server sale', async () => {
    const server = fakeServer();
    let dropFirstResponse = true;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        // The server COMMITS, then the response is lost on the way back.
        const res = await server.handler(url, init);
        if (dropFirstResponse) {
          dropFirstResponse = false;
          throw new TypeError('socket hang up');
        }
        return res;
      }),
    );

    const saleId = new SaleRepository(db).create(saleInput());

    await saleSyncService.run({ accessToken: TOKEN }); // commits, response lost
    expect(queueRowFor(saleId).status).toBe('PENDING');

    db.prepare("UPDATE sync_queue SET next_attempt_at = '2000-01-01T00:00:00.000Z'").run();
    const second = await saleSyncService.run({ accessToken: TOKEN });

    expect(second.synced).toBe(1);
    // TWO requests, ONE server sale — the whole point.
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].client_uuid).toBe(server.requests[1].client_uuid);
    expect(server.created.size).toBe(1);
  });

  it('recovers a row stranded in PROCESSING by a crash', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const saleId = new SaleRepository(db).create(saleInput());

    // Simulate the crash: claimed, then the process died before any outcome.
    db.prepare(
      "UPDATE sync_queue SET status = 'PROCESSING', last_attempt_at = '2000-01-01T00:00:00.000Z'",
    ).run();
    expect(queueRowFor(saleId).status).toBe('PROCESSING');

    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.synced).toBe(1);
    expect(queueRowFor(saleId).status).toBe('SYNCED');
  });

  it('stale recovery does not charge the bill a retry attempt', async () => {
    new SaleRepository(db).create(saleInput());
    db.prepare(
      "UPDATE sync_queue SET status = 'PROCESSING', last_attempt_at = '2000-01-01T00:00:00.000Z'",
    ).run();

    expect(new SyncRepository(db).recoverStale()).toBe(1);
    const row = db.prepare('SELECT * FROM sync_queue').get() as Record<string, unknown>;
    expect(row.status).toBe('PENDING');
    expect(row.attempt_count).toBe(0);
  });

  it('does not recover a row that was only just claimed', () => {
    new SaleRepository(db).create(saleInput());
    new SyncRepository(db).claimBatch(10, 'sale');
    // Freshly claimed rows belong to a live worker.
    expect(new SyncRepository(db).recoverStale()).toBe(0);
  });

  it('the queue and the sale both survive a restart', async () => {
    closeDatabase(); // release the per-test connection opened in beforeEach
    const file = path.join(tempDir, 'restart.db');
    db = openDatabase(file);
    runMigrations(db);
    new DeviceRepository(db).getOrCreate();

    const saleId = new SaleRepository(db).create(saleInput());
    closeDatabase();

    db = openDatabase(file);
    runMigrations(db);
    expect(queueRowFor(saleId).status).toBe('PENDING');

    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.synced).toBe(1);
    expect(server.requests[0].client_uuid).toBe(saleId);
  });

  it('does not re-push a sale that already has a server id', async () => {
    const called = vi.fn(async () => jsonResponse(201, saleRead()));
    vi.stubGlobal('fetch', called);

    const saleId = new SaleRepository(db).create(saleInput());
    new SaleRepository(db).markSynced(saleId, randomUUID(), 'INV-1', 1143, 24000);
    // The queue row was never closed — the crash happened after the server
    // replied but before the bookkeeping finished.
    db.prepare("UPDATE sync_queue SET status = 'PENDING'").run();

    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.synced).toBe(1);
    expect(called).not.toHaveBeenCalled();
    expect(queueRowFor(saleId).status).toBe('SYNCED');
  });
});

describe('queue mechanics', () => {
  it('claims in FIFO order', () => {
    const repo = new SaleRepository(db);
    const ids = [repo.create(saleInput()), repo.create(saleInput()), repo.create(saleInput())];
    // created_at has second-ish resolution, so make the order unambiguous.
    ids.forEach((id, i) => {
      db.prepare('UPDATE sync_queue SET created_at = ? WHERE entity_id = ?').run(
        `2026-01-0${i + 1}T00:00:00.000Z`,
        id,
      );
    });

    const claimed = new SyncRepository(db).claimBatch(10, 'sale');
    expect(claimed.map((r) => r.entity_id)).toEqual(ids);
  });

  it('a claimed row cannot be claimed again', () => {
    new SaleRepository(db).create(saleInput());
    const sync = new SyncRepository(db);

    expect(sync.claimBatch(10, 'sale')).toHaveLength(1);
    // Second worker arrives — the row is already PROCESSING.
    expect(sync.claimBatch(10, 'sale')).toHaveLength(0);
  });

  it('two workers split a batch rather than duplicating it', () => {
    const repo = new SaleRepository(db);
    for (let i = 0; i < 6; i++) repo.create(saleInput());

    const a = new SyncRepository(db).claimBatch(3, 'sale');
    const b = new SyncRepository(db).claimBatch(3, 'sale');

    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    const overlap = a.filter((x) => b.some((y) => y.id === x.id));
    expect(overlap).toHaveLength(0);
  });

  it('a second concurrent run is refused', async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return jsonResponse(201, saleRead());
      }),
    );

    new SaleRepository(db).create(saleInput());
    const first = saleSyncService.run({ accessToken: TOKEN });
    const second = await saleSyncService.run({ accessToken: TOKEN });

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already in progress/i);

    release(null);
    expect((await first).synced).toBe(1);
  });

  it('respects the batch limit', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);
    const repo = new SaleRepository(db);
    for (let i = 0; i < 10; i++) repo.create(saleInput());

    const result = await saleSyncService.run({ accessToken: TOKEN, limit: 4 });
    expect(result.attempted).toBe(4);
    expect(result.synced).toBe(4);
  });

  it('does not claim a row whose backoff has not elapsed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, null)));
    new SaleRepository(db).create(saleInput());

    await saleSyncService.run({ accessToken: TOKEN });
    // next_attempt_at is in the future now.
    const second = await saleSyncService.run({ accessToken: TOKEN });
    expect(second.attempted).toBe(0);
  });

  it('is a no-op with an empty queue', async () => {
    const called = vi.fn();
    vi.stubGlobal('fetch', called);
    const result = await saleSyncService.run({ accessToken: TOKEN });

    expect(result.attempted).toBe(0);
    expect(result.ok).toBe(true);
    expect(called).not.toHaveBeenCalled();
  });
});

describe('repeated scheduler-driven runs (Phase 7)', () => {
  it('converges without duplicating anything', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const repo = new SaleRepository(db);
    for (let i = 0; i < 12; i++) repo.create(saleInput());

    // The loop firing over and over, as it now does in production.
    let synced = 0;
    for (let pass = 0; pass < 6; pass++) {
      synced += (await saleSyncService.run({ accessToken: TOKEN, limit: 5 })).synced;
    }

    expect(synced).toBe(12);
    // Twelve bills, twelve server sales — no matter how many times we asked.
    expect(server.created.size).toBe(12);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status <> 'SYNCED'").get() as {
        n: number;
      }).n,
    ).toBe(0);
  });

  it('extra runs after the queue drains are harmless no-ops', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    new SaleRepository(db).create(saleInput());
    await saleSyncService.run({ accessToken: TOKEN });
    const afterFirst = server.requests.length;

    // The loop keeps ticking long after everything has synced.
    for (let i = 0; i < 5; i++) await saleSyncService.run({ accessToken: TOKEN });

    // No further requests, and still exactly one sale.
    expect(server.requests.length).toBe(afterFirst);
    expect(server.created.size).toBe(1);
  });

  it('leaves blocked bills queued across many runs without exhausting them', async () => {
    // The overnight case: the loop runs all night against a closed till.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, errorEnvelope('NO_OPEN_DAY_SESSION'))),
    );
    const saleId = new SaleRepository(db).create(saleInput());

    for (let i = 0; i < 8; i++) {
      db.prepare("UPDATE sync_queue SET next_attempt_at = '2000-01-01T00:00:00.000Z'").run();
      await saleSyncService.run({ accessToken: TOKEN });
    }

    const row = queueRowFor(saleId);
    // Still alive, still blocked, and never charged a retry attempt.
    expect(row.status).toBe('PENDING');
    expect(row.failure_kind).toBe('BLOCKED');
    expect(row.attempt_count).toBe(0);
    expect(new SaleRepository(db).get(saleId)).not.toBeNull();
  });
});

describe('dry run', () => {
  it('builds and validates payloads without contacting the server', () => {
    const called = vi.fn();
    vi.stubGlobal('fetch', called);
    new SaleRepository(db).create(saleInput());

    const result = saleSyncService.dryRun();

    expect(result.buildable).toBe(1);
    expect(result.unbuildable).toBe(0);
    expect(called).not.toHaveBeenCalled();
  });

  it('leaves every queue row exactly as it found it', () => {
    new SaleRepository(db).create(saleInput());
    const before = db.prepare('SELECT * FROM sync_queue').all();

    saleSyncService.dryRun();

    expect(db.prepare('SELECT * FROM sync_queue').all()).toEqual(before);
  });

  it('names the sales that cannot be converted, and why', () => {
    const repo = new SaleRepository(db);
    repo.create(saleInput());
    repo.create(saleInput({ items: [{ ...saleInput().items[0], serverVariantId: null }] }));

    const result = saleSyncService.dryRun();

    expect(result.total).toBe(2);
    expect(result.buildable).toBe(1);
    expect(result.unbuildable).toBe(1);
    expect(result.lines.find((l) => !l.buildable)?.reason).toMatch(/variant id/i);
  });

  it('exposes shape and totals but no personal data', () => {
    new SaleRepository(db).create(
      saleInput({ serverCustomerId: '66666666-6666-4666-8666-666666666666' }),
    );

    const text = JSON.stringify(saleSyncService.dryRun().lines[0].shape);
    expect(text).not.toContain('66666666-6666-4666-8666-666666666666');
    expect(text).not.toContain('UPI-TXN-9931');
    expect(text).toContain('line_count');
  });
});

describe('performance and non-blocking behaviour', () => {
  it('checkout does not wait for synchronisation', () => {
    // fetch is stubbed to hang forever; committing a bill must be unaffected.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const started = Date.now();
    const saleId = new SaleRepository(db).create(saleInput());
    const elapsed = Date.now() - started;

    expect(saleId).toBeTruthy();
    expect(elapsed).toBeLessThan(500);
    expect(queueRowFor(saleId).status).toBe('PENDING');
  });

  it('drains a realistic backlog', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.handler);

    const repo = new SaleRepository(db);
    for (let i = 0; i < 200; i++) repo.create(saleInput());

    const started = Date.now();
    let synced = 0;
    // Batched, exactly as a scheduled worker would drain it.
    for (let pass = 0; pass < 8; pass++) {
      synced += (await saleSyncService.run({ accessToken: TOKEN, limit: 25 })).synced;
    }
    const elapsed = Date.now() - started;

    expect(synced).toBe(200);
    expect(server.created.size).toBe(200);
    // eslint-disable-next-line no-console
    console.log(`[perf] drained 200 queued sales in ${elapsed}ms`);

    const remaining = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE status <> 'SYNCED'")
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});
