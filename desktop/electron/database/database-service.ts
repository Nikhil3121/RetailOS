/**
 * Database service — the single entry point the rest of the main process uses.
 *
 * Owns startup ordering: open → migrate → ensure device identity. IPC handlers
 * talk to this, never to `better-sqlite3` directly, and never build SQL of
 * their own.
 *
 * Initialisation is deliberately fault-tolerant at the APP level: if the
 * database cannot be opened or migrated, `initialize()` records the failure and
 * returns a non-ready result rather than throwing into `app.whenReady()`. The
 * window still opens and the existing HTTP billing path still works, because
 * nothing in the current POS depends on SQLite yet. Crashing the whole app over
 * an unused subsystem would be a regression.
 */

import { closeDatabase, databasePath, getDatabase, openDatabase, requireDatabase } from './connection';
import { describeError, log } from './logger';
import { currentSchemaVersion, runMigrations } from './migrations';
import { CatalogRepository } from './repositories/catalog-repository';
import { DeviceRepository, type DeviceIdentity } from './repositories/device-repository';
import { ProductRepository } from './repositories/product-repository';
import { SaleRepository } from './repositories/sale-repository';
import { StoreRepository } from './repositories/store-repository';
import { SyncRepository } from './repositories/sync-repository';

export interface InitResult {
  ready: boolean;
  schemaVersion: number;
  devicePresent: boolean;
  error?: string;
}

class DatabaseService {
  private ready = false;
  private lastError: string | null = null;

  /** Run once at app start. Safe to call again; returns current state. */
  initialize(): InitResult {
    if (this.ready) {
      return {
        ready: true,
        schemaVersion: currentSchemaVersion(requireDatabase()),
        devicePresent: this.devices().find() !== null,
      };
    }

    try {
      log.info('database.initializing', { path: databasePath() });
      const db = openDatabase();

      runMigrations(db);

      // Create the device identity as part of startup so the renderer can
      // always assume one exists by the time a window is interactive.
      const identity = this.devices(db).getOrCreate();

      this.ready = true;
      this.lastError = null;

      const version = currentSchemaVersion(db);
      log.info('database.ready', {
        schema_version: version,
        device_uuid: identity.deviceUuid,
      });

      return { ready: true, schemaVersion: version, devicePresent: true };
    } catch (err) {
      const described = describeError(err);
      this.lastError = String(described.error_message ?? 'unknown');
      this.ready = false;
      log.error('database.initialization_failed', described);

      // Leave the connection closed so a later retry starts clean rather than
      // reusing a handle that may be attached to a half-migrated file.
      closeDatabase();

      return {
        ready: false,
        schemaVersion: 0,
        devicePresent: false,
        error: this.lastError,
      };
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  status(): InitResult {
    if (!this.ready) {
      return {
        ready: false,
        schemaVersion: 0,
        devicePresent: false,
        ...(this.lastError ? { error: this.lastError } : {}),
      };
    }
    const db = requireDatabase();
    return {
      ready: true,
      schemaVersion: currentSchemaVersion(db),
      devicePresent: this.devices(db).find() !== null,
    };
  }

  devices(db = requireDatabase()): DeviceRepository {
    return new DeviceRepository(db);
  }

  products(db = requireDatabase()): ProductRepository {
    return new ProductRepository(db);
  }

  /** Local catalog — the barcode/SKU lookup path added in Phase 2. */
  catalog(db = requireDatabase()): CatalogRepository {
    return new CatalogRepository(db);
  }

  sales(db = requireDatabase()): SaleRepository {
    return new SaleRepository(db);
  }

  /** Shop details for the receipt header. Cached locally so a bill still
   *  prints its GSTIN with the network down. */
  stores(db = requireDatabase()): StoreRepository {
    return new StoreRepository(db);
  }

  syncs(db = requireDatabase()): SyncRepository {
    return new SyncRepository(db);
  }

  /** Identity for the renderer. Returns null when the database is unavailable
   *  so the caller can degrade rather than crash. */
  identity(): DeviceIdentity | null {
    if (!this.ready || !getDatabase()) return null;
    return this.devices().getOrCreate();
  }

  shutdown(): void {
    closeDatabase();
    this.ready = false;
  }
}

export const databaseService = new DatabaseService();
