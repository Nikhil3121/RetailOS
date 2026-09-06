/**
 * IPC registration.
 *
 * Each channel is a NAMED OPERATION, never a SQL passthrough. The renderer can
 * ask "search products for this term" but cannot ask "run this statement" —
 * there is no channel that accepts SQL, and adding one would defeat the whole
 * boundary.
 *
 * Every handler follows the same shape:
 *   1. validate every argument (throws IpcValidationError on bad input)
 *   2. delegate to a repository (all SQL lives there)
 *   3. return a discriminated result the renderer can branch on
 *
 * Errors never propagate raw. `wrap()` converts a throw into
 * `{ ok: false, error }` so the renderer gets a predictable rejection and the
 * main process logs the cause with its channel name attached.
 */

import { ipcMain } from 'electron';

import { catalogSyncService } from '../catalog/catalog-sync-service';
import { backupScheduler, checkIntegrity, createBackup, listBackups, verifyBackup } from '../database/backup-service';
import { describeMissingDriver, printerService } from '../printing/printer-service';
import type { ShopDetails } from '../printing/receipt-formatter';
import { saleSyncService } from '../sync/sale-sync-service';
import { requireDatabase } from '../database/connection';
import { databaseService } from '../database/database-service';
import { describeError, log } from '../database/logger';
import { getPosConfig } from '../pos-config';
import {
  IpcValidationError,
  optionalString,
  optionalUuid,
  requireArray,
  requireInt,
  requireNumber,
  requireObject,
  requireOneOf,
  requireString,
  requireUuid,
} from './validation';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/**
 * Wrap a handler so it can never leak an exception across the IPC boundary.
 * Validation errors return their message (safe, actionable). Anything else
 * returns a generic message — an internal SQLite error string could disclose
 * schema or filesystem detail to a renderer that should not have it.
 */
function wrap<T>(channel: string, fn: (...args: unknown[]) => T) {
  return (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): IpcResult<T> => {
    try {
      return { ok: true, data: fn(...args) };
    } catch (err) {
      if (err instanceof IpcValidationError) {
        log.warn('ipc.validation_failed', { channel, error_message: err.message });
        return { ok: false, error: err.message, code: 'VALIDATION' };
      }
      log.error('ipc.handler_failed', { channel, ...describeError(err) });
      return { ok: false, error: 'Operation failed.', code: 'INTERNAL' };
    }
  };
}

function assertReady(): void {
  if (!databaseService.isReady()) {
    throw new Error('Database is not ready.');
  }
}

/**
 * Build the receipt header from the locally cached store.
 *
 * Returns undefined when the store has never been snapshotted, which leaves the
 * formatter on its existing default. A bare header is bad; a THROW here would
 * be worse — it would refuse to print a receipt for a sale that is already
 * committed and a customer who is already waiting.
 */
function shopFor(serverStoreId: string | null): ShopDetails | undefined {
  if (!serverStoreId) return undefined;
  const store = databaseService.stores().findByServerId(serverStoreId);
  if (!store) return undefined;

  return {
    name: store.name,
    // The server keeps the address as one free-text block. Splitting on real
    // line breaks preserves the layout the manager typed instead of collapsing
    // a three-line address into one wrapped run.
    addressLines: (store.address ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
    gstin: store.gstin,
    phone: store.phone,
    footer: store.receiptMessage ?? undefined,
  };
}

export function registerDatabaseIpc(): void {
  // ---- device ----

  ipcMain.handle(
    'device:getIdentity',
    wrap('device:getIdentity', () => {
      assertReady();
      return databaseService.devices().getOrCreate();
    }),
  );

  ipcMain.handle(
    'device:updateAssignment',
    wrap('device:updateAssignment', (raw) => {
      assertReady();
      const patch = requireObject(raw, 'patch');
      return databaseService.devices().updateAssignment({
        terminalCode: optionalString(patch.terminalCode, 'terminalCode', 32),
        terminalName: optionalString(patch.terminalName, 'terminalName', 64),
        organizationId: optionalString(patch.organizationId, 'organizationId', 64),
        mallId: optionalString(patch.mallId, 'mallId', 64),
        storeId: optionalString(patch.storeId, 'storeId', 64),
      });
    }),
  );

  // ---- config ----

  ipcMain.handle('config:get', wrap('config:get', () => getPosConfig()));

  // ---- database ----

  ipcMain.handle('database:initialize', wrap('database:initialize', () => databaseService.initialize()));

  ipcMain.handle('database:status', wrap('database:status', () => databaseService.status()));

  ipcMain.handle(
    'database:products:search',
    wrap('database:products:search', (rawQuery, rawLimit) => {
      assertReady();
      const query = requireString(rawQuery, 'query', 128);
      const limit =
        rawLimit === undefined ? 50 : requireInt(rawLimit, 'limit', { min: 1, max: 200 });
      return databaseService.products().search(query, limit);
    }),
  );

  ipcMain.handle(
    'database:products:findByCode',
    wrap('database:products:findByCode', (rawCode) => {
      assertReady();
      const code = requireString(rawCode, 'code', 64);
      return databaseService.products().findByCode(code);
    }),
  );

  ipcMain.handle(
    'database:sales:create',
    wrap('database:sales:create', (raw) => {
      assertReady();
      const input = requireObject(raw, 'sale');

      const items = requireArray(
        input.items,
        'items',
        (rawItem, i) => {
          const item = requireObject(rawItem, `items[${i}]`);
          return {
            productId: optionalUuid(item.productId, `items[${i}].productId`),
            productName: requireString(item.productName, `items[${i}].productName`, 255),
            sku: optionalString(item.sku, `items[${i}].sku`, 64),
            // The server variant uuid. Optional at this boundary so pre-005
            // callers keep working, but without it the line can never be
            // pushed — POST /sales requires lines[].variant_id.
            serverVariantId: optionalUuid(item.serverVariantId, `items[${i}].serverVariantId`),
            hsnCode: optionalString(item.hsnCode, `items[${i}].hsnCode`, 16),
            mrpPaise: item.mrpPaise === undefined
              ? 0
              : requireInt(item.mrpPaise, `items[${i}].mrpPaise`, { min: 0 }),
            // 0–100% expressed in basis points.
            discountPctBp: item.discountPctBp === undefined
              ? 0
              : requireInt(item.discountPctBp, `items[${i}].discountPctBp`, {
                  min: 0,
                  max: 10_000,
                }),
            // Quantity is fractional (fabric sold by the metre) and must be
            // positive — a zero or negative line is a returns concept, which
            // this phase does not implement.
            quantity: requireNumber(item.quantity, `items[${i}].quantity`, {
              min: 0.001,
              max: 1_000_000,
            }),
            unitPricePaise: requireInt(item.unitPricePaise, `items[${i}].unitPricePaise`, {
              min: 0,
            }),
            discountPaise: item.discountPaise === undefined
              ? 0
              : requireInt(item.discountPaise, `items[${i}].discountPaise`, { min: 0 }),
            taxRateBp: item.taxRateBp === undefined
              ? 0
              : requireInt(item.taxRateBp, `items[${i}].taxRateBp`, { min: 0, max: 10_000 }),
            taxPaise: item.taxPaise === undefined
              ? 0
              : requireInt(item.taxPaise, `items[${i}].taxPaise`, { min: 0 }),
            lineTotalPaise: requireInt(item.lineTotalPaise, `items[${i}].lineTotalPaise`, {
              min: 0,
            }),
          };
        },
        { min: 1, max: 500 },
      );

      const payments =
        input.payments === undefined
          ? []
          : requireArray(input.payments, 'payments', (rawPayment, i) => {
              const p = requireObject(rawPayment, `payments[${i}]`);
              return {
                method: requireOneOf(p.method, `payments[${i}].method`, [
                  'cash',
                  'card',
                  'upi',
                  'credit',
                ] as const),
                amountPaise: requireInt(p.amountPaise, `payments[${i}].amountPaise`, { min: 0 }),
                reference: optionalString(p.reference, `payments[${i}].reference`, 128),
              };
            });

      return databaseService.sales().create({
        id: input.id === undefined ? undefined : requireUuid(input.id, 'id'),
        terminalId: optionalString(input.terminalId, 'terminalId', 64),
        storeId: null, // local FK — populated once stores sync (Phase 5)
        serverStoreId: optionalString(input.storeId, 'storeId', 64),
        serverCustomerId: optionalUuid(input.customerId, 'customerId'),
        serverDaySessionId: optionalUuid(input.daySessionId, 'daySessionId'),
        occurredAt: optionalString(input.occurredAt, 'occurredAt', 40),
        terminalUuid: optionalString(input.terminalUuid, 'terminalUuid', 64),
        customerId: null, // local FK — see serverCustomerId
        serverSalespersonUserId: optionalUuid(
          input.salespersonUserId,
          'salespersonUserId',
        ),
        status: input.status === undefined
          ? 'COMPLETED'
          : requireOneOf(input.status, 'status', ['DRAFT', 'COMPLETED', 'VOID'] as const),
        subtotalPaise: requireInt(input.subtotalPaise, 'subtotalPaise', { min: 0 }),
        discountPaise: input.discountPaise === undefined
          ? 0
          : requireInt(input.discountPaise, 'discountPaise', { min: 0 }),
        taxPaise: input.taxPaise === undefined
          ? 0
          : requireInt(input.taxPaise, 'taxPaise', { min: 0 }),
        totalPaise: requireInt(input.totalPaise, 'totalPaise', { min: 0 }),
        // Whole-bill adjustments. Validated to the same standard as every
        // other figure crossing this boundary: the renderer is not trusted to
        // send a well-formed number just because it usually does.
        billDiscountPaise: input.billDiscountPaise === undefined
          ? 0
          : requireInt(input.billDiscountPaise, 'billDiscountPaise', { min: 0 }),
        billDiscountReason: optionalString(
          input.billDiscountReason,
          'billDiscountReason',
          200,
        ),
        couponCode: optionalString(input.couponCode, 'couponCode', 64),
        redeemPoints: input.redeemPoints === undefined
          ? 0
          : requireInt(input.redeemPoints, 'redeemPoints', { min: 0 }),
        // Signed, unlike every other money field here — rounding down is a
        // negative figure and a `min: 0` would silently drop it. Bounded to
        // under a rupee either way, because that is all rounding to the whole
        // rupee can ever be; anything larger is a bug upstream, not a bill.
        roundOffPaise: input.roundOffPaise === undefined
          ? 0
          : requireInt(input.roundOffPaise, 'roundOffPaise', { min: -99, max: 99 }),
        notes: optionalString(input.notes, 'notes', 1000),
        items,
        payments,
      });
    }),
  );

  // Read-only listing of local sales with their sync state. Named operation,
  // no SQL crosses the boundary, and nothing here writes.
  ipcMain.handle(
    'database:sales:list',
    wrap('database:sales:list', (rawLimit) => {
      assertReady();
      const limit =
        rawLimit === undefined ? 100 : requireInt(rawLimit, 'limit', { min: 1, max: 500 });
      return databaseService.sales().list(limit);
    }),
  );

  ipcMain.handle(
    'database:sales:get',
    wrap('database:sales:get', (rawId) => {
      assertReady();
      return databaseService.sales().get(requireUuid(rawId, 'saleId'));
    }),
  );

  // ---- catalog (Phase 2) ----

  ipcMain.handle(
    'catalog:getStatus',
    wrap('catalog:getStatus', () => {
      assertReady();
      const state = databaseService.catalog().getState();
      return { ...state, syncing: catalogSyncService.isSyncing() };
    }),
  );

  ipcMain.handle(
    'catalog:findByBarcode',
    wrap('catalog:findByBarcode', (rawCode) => {
      assertReady();
      return databaseService.catalog().findByBarcode(requireString(rawCode, 'barcode', 64));
    }),
  );

  ipcMain.handle(
    'catalog:findBySku',
    wrap('catalog:findBySku', (rawSku) => {
      assertReady();
      return databaseService.catalog().findBySku(requireString(rawSku, 'sku', 64));
    }),
  );

  ipcMain.handle(
    'catalog:findByCode',
    wrap('catalog:findByCode', (rawCode) => {
      assertReady();
      return databaseService.catalog().findByCode(requireString(rawCode, 'code', 64));
    }),
  );

  ipcMain.handle(
    'catalog:search',
    wrap('catalog:search', (rawQuery, rawLimit) => {
      assertReady();
      const query = requireString(rawQuery, 'query', 128);
      const limit =
        rawLimit === undefined ? 50 : requireInt(rawLimit, 'limit', { min: 1, max: 200 });
      return databaseService.catalog().search(query, limit);
    }),
  );

  // Async handler — the only one that touches the network. Returns a result
  // object rather than throwing so the renderer can show a specific message.
  ipcMain.handle('catalog:sync', async (_event, rawToken: unknown) => {
    try {
      assertReady();
      const accessToken = requireString(rawToken, 'accessToken', 4096);
      const result = await catalogSyncService.sync({ accessToken, maxProducts: 200_000 });
      return { ok: result.ok, data: result, ...(result.error ? { error: result.error } : {}) };
    } catch (err) {
      if (err instanceof IpcValidationError) {
        log.warn('ipc.validation_failed', { channel: 'catalog:sync', error_message: err.message });
        return { ok: false, error: err.message, code: 'VALIDATION' };
      }
      log.error('ipc.handler_failed', { channel: 'catalog:sync', ...describeError(err) });
      return { ok: false, error: 'Catalog sync failed.', code: 'INTERNAL' };
    }
  });

  // ---- store snapshot ----
  //
  // The renderer is the only side that is authenticated, so it is the only side
  // that can read the store from the server. It hands the result down here to
  // be written to SQLite, and the PRINTER reads it back from SQLite — which is
  // what lets a receipt carry the shop's GSTIN with no network at all.

  ipcMain.handle(
    'store:snapshot',
    wrap('store:snapshot', (raw) => {
      assertReady();
      const input = requireObject(raw, 'store');
      return databaseService.stores().snapshot({
        serverId: requireUuid(input.serverId, 'serverId'),
        code: requireString(input.code, 'code', 32),
        name: requireString(input.name, 'name', 128),
        gstin: optionalString(input.gstin, 'gstin', 15),
        address: optionalString(input.address, 'address', 512),
        phone: optionalString(input.phone, 'phone', 32),
        // 280 to match stores.receipt_message on the server exactly. A shorter
        // cap here would silently print less than the manager saved.
        receiptMessage: optionalString(input.receiptMessage, 'receiptMessage', 280),
      });
    }),
  );

  // ---- printing ----
  //
  // Hardware stays in the main process. The renderer sends a sale id and gets
  // a result back; it never touches a device handle, a file path or a byte
  // buffer, so no Node capability is added to the renderer for printing.

  ipcMain.handle(
    'printer:status',
    wrap('printer:status', () => ({
      ...printerService.status(),
      missingDriver: describeMissingDriver(),
    })),
  );

  ipcMain.handle(
    'printer:configure',
    wrap('printer:configure', (raw) => {
      const patch = requireObject(raw, 'config');
      return printerService.configure({
        driver: patch.driver === undefined
          ? undefined
          : requireOneOf(patch.driver, 'driver', ['virtual', 'none'] as const),
        width: patch.width === undefined
          ? undefined
          : requireOneOf(patch.width, 'width', ['58mm', '80mm'] as const),
      });
    }),
  );

  ipcMain.handle('printer:test', async () => {
    try {
      return { ok: true, data: await printerService.printTestPage() };
    } catch (err) {
      log.error('ipc.handler_failed', { channel: 'printer:test', ...describeError(err) });
      return { ok: false, error: 'Test print failed.', code: 'INTERNAL' };
    }
  });

  // Prints a sale that is ALREADY committed. The receipt is rendered from the
  // stored row, so what prints cannot disagree with what was saved.
  ipcMain.handle('printer:printSale', async (_event, rawSaleId: unknown, rawOptions: unknown) => {
    try {
      assertReady();
      const saleId = requireUuid(rawSaleId, 'saleId');
      const sale = databaseService.sales().get(saleId);
      if (!sale) return { ok: false, error: 'Sale not found.', code: 'NOT_FOUND' };

      const options = rawOptions === undefined ? {} : requireObject(rawOptions, 'options');
      const result = await printerService.printSale(sale, {
        width: options.width === undefined
          ? undefined
          : requireOneOf(options.width, 'width', ['58mm', '80mm'] as const),
        openDrawer: options.openDrawer === true,
        // Read from the LOCAL snapshot, not from the renderer or the network.
        // A receipt without the shop's GSTIN is not a tax invoice, and the one
        // moment it must not go missing is the moment the connection does.
        shop: shopFor(sale.serverStoreId),
      });
      return { ok: true, data: result };
    } catch (err) {
      if (err instanceof IpcValidationError) {
        return { ok: false, error: err.message, code: 'VALIDATION' };
      }
      log.error('ipc.handler_failed', { channel: 'printer:printSale', ...describeError(err) });
      return { ok: false, error: 'Printing failed.', code: 'INTERNAL' };
    }
  });

  // ---- backup ----
  //
  // NOTE: restore is deliberately NOT exposed over IPC. It replaces the live
  // database, which is the single most destructive thing this app can do, and
  // it requires the connection to be closed first. A one-click renderer button
  // would make it far too easy to do by accident. It is implemented and tested
  // in backup-service.ts for a supervised recovery.

  ipcMain.handle(
    'backup:list',
    wrap('backup:list', () => listBackups()),
  );

  ipcMain.handle(
    'backup:verify',
    wrap('backup:verify', (rawFile) => verifyBackup(requireString(rawFile, 'file', 4096))),
  );

  ipcMain.handle(
    'backup:integrity',
    wrap('backup:integrity', () => {
      assertReady();
      return checkIntegrity(requireDatabase());
    }),
  );

  // Async: the online backup API returns a promise.
  ipcMain.handle('backup:create', async () => {
    try {
      assertReady();
      if (backupScheduler.isRunning()) {
        return { ok: false, error: 'A backup is already running.', code: 'BUSY' };
      }
      const result = await createBackup(requireDatabase());
      return result.ok
        ? { ok: true, data: result.entry }
        : { ok: false, error: result.error ?? 'Backup failed.', code: 'INTERNAL' };
    } catch (err) {
      log.error('ipc.handler_failed', { channel: 'backup:create', ...describeError(err) });
      return { ok: false, error: 'Backup failed.', code: 'INTERNAL' };
    }
  });

  // ---- sync ----

  ipcMain.handle(
    'sync:getStatus',
    wrap('sync:getStatus', () => {
      assertReady();
      const sync = databaseService.syncs();
      return {
        queue: sync.counts(),
        failures: sync.failureKindCounts(),
        states: sync.allStates(),
        running: saleSyncService.isRunning(),
        // Sales whose server-computed tax disagrees with the printed receipt.
        // Surfaced rather than corrected — see sale-sync-service.
        divergent: databaseService.sales().divergentSales(),
      };
    }),
  );

  /**
   * DRY RUN — reconstruct and validate payloads WITHOUT creating a server
   * sale. Read-only: it does not claim, mutate or advance a single queue row.
   */
  ipcMain.handle(
    'sync:sales:dryRun',
    wrap('sync:sales:dryRun', (rawLimit) => {
      assertReady();
      const limit =
        rawLimit === undefined ? 25 : requireInt(rawLimit, 'limit', { min: 1, max: 200 });
      return saleSyncService.dryRun(limit);
    }),
  );

  // Async — the only sale channel that reaches the network. Returns a result
  // object rather than throwing so the renderer can report precisely.
  ipcMain.handle(
    'sync:sales:run',
    async (_event, rawToken: unknown, rawLimit: unknown, rawApiBaseUrl: unknown) => {
    try {
      assertReady();
      const accessToken = requireString(rawToken, 'accessToken', 4096);
      const limit =
        rawLimit === undefined ? 25 : requireInt(rawLimit, 'limit', { min: 1, max: 200 });
      // Where the renderer authenticated. A token is only valid at the server
      // that issued it, so the credential and its origin arrive together.
      const apiBaseUrl = optionalString(rawApiBaseUrl, 'apiBaseUrl', 2048);
      const result = await saleSyncService.run({ accessToken, apiBaseUrl, limit });
      return { ok: result.ok, data: result, ...(result.error ? { error: result.error } : {}) };
    } catch (err) {
      if (err instanceof IpcValidationError) {
        log.warn('ipc.validation_failed', {
          channel: 'sync:sales:run',
          error_message: err.message,
        });
        return { ok: false, error: err.message, code: 'VALIDATION' };
      }
      log.error('ipc.handler_failed', { channel: 'sync:sales:run', ...describeError(err) });
      return { ok: false, error: 'Sale synchronisation failed.', code: 'INTERNAL' };
    }
  },
  );

  log.info('ipc.registered', { channel_count: 26 });
}
