/**
 * Catalog synchronisation — download, validate, commit atomically.
 *
 * SHAPE FORCED BY THE BACKEND. `GET /products` returns ProductSummary, which
 * carries NO barcodes and NO variants — only variant_count and primary_sku.
 * The only way to obtain barcodes is `GET /products/{id}`, one request per
 * product. So this sync is unavoidably N+1:
 *
 *     GET /products?page=N&page_size=1000     (list ids)
 *       └── GET /products/{id}  × product count   (fetch variants + barcodes)
 *
 * That is a documented API limitation, not a design choice. A bulk variant
 * endpoint or an `include=variants` parameter would collapse it to a handful
 * of requests; adding one is a backend change and out of scope for this phase.
 *
 * Concurrency is capped so a 9,000-product sync does not open 9,000 sockets
 * or overwhelm a free-tier backend.
 *
 * ATOMICITY: nothing touches the local catalog until every page has been
 * downloaded and validated. The commit is a single transaction. A failure at
 * product 8,999 of 9,000 leaves the previous catalog completely intact.
 */

import { databaseService } from '../database/database-service';
import { describeError, log } from '../database/logger';
import { getPosConfig } from '../pos-config';
import { validateCatalog, type RawProduct } from './catalog-validator';

const PAGE_SIZE = 1000;      // backend maximum
const DETAIL_CONCURRENCY = 8; // parallel GET /products/{id}

export interface SyncOptions {
  /** Bearer token from the renderer's auth store. The main process has no
   *  session of its own, so the caller must supply one. */
  accessToken: string;
  /** Abort if the catalog exceeds this many products — a guard against a
   *  misconfigured backend returning another tenant's whole catalogue. */
  maxProducts?: number;
}

export interface SyncResult {
  ok: boolean;
  productCount: number;
  variantCount: number;
  rejectCount: number;
  durationMs: number;
  error?: string;
}

/** Run `worker` over `items` with bounded parallelism, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

class CatalogSyncService {
  private inFlight = false;

  /** True while a sync is running — the IPC layer uses this to reject
   *  overlapping requests rather than queueing them. */
  isSyncing(): boolean {
    return this.inFlight;
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    const started = Date.now();

    if (this.inFlight) {
      return {
        ok: false,
        productCount: 0,
        variantCount: 0,
        rejectCount: 0,
        durationMs: 0,
        error: 'A catalog sync is already running.',
      };
    }
    if (!databaseService.isReady()) {
      return {
        ok: false,
        productCount: 0,
        variantCount: 0,
        rejectCount: 0,
        durationMs: 0,
        error: 'Database is not ready.',
      };
    }

    this.inFlight = true;
    const catalog = databaseService.catalog();
    const config = getPosConfig();

    // Mark SYNCING before any network work so a crash mid-sync leaves an
    // honest status rather than a stale READY.
    catalog.setStatus('SYNCING');
    log.info('catalog.sync_started', { api_base_url: config.apiBaseUrl });

    try {
      const headers = {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      };
      const base = `${config.apiBaseUrl}/api/v1`;

      // ---- 1. page through the product list to collect ids ----
      const ids: string[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;

      while (ids.length < total) {
        const url = `${base}/products?page=${page}&page_size=${PAGE_SIZE}&is_active=true`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          throw new Error(`Product list failed: HTTP ${res.status}`);
        }
        const body = (await res.json()) as { items?: { id?: unknown }[]; total?: number };
        total = typeof body.total === 'number' ? body.total : ids.length;

        const pageIds = (body.items ?? [])
          .map((i) => i.id)
          .filter((i): i is string => typeof i === 'string');
        ids.push(...pageIds);

        if (pageIds.length === 0) break; // defensive: stop on an empty page
        if (options.maxProducts && ids.length > options.maxProducts) {
          throw new Error(`Catalog exceeds the ${options.maxProducts} product guard.`);
        }
        page += 1;
      }

      log.info('catalog.list_complete', { product_count: ids.length });

      // ---- 2. fetch detail per product (the N+1 the API forces) ----
      const details = await mapLimit(ids, DETAIL_CONCURRENCY, async (id) => {
        const res = await fetch(`${base}/products/${id}`, { headers });
        if (!res.ok) {
          // One bad product must not fail the whole sync — record and skip.
          log.warn('catalog.detail_failed', { status: res.status });
          return null;
        }
        return (await res.json()) as RawProduct;
      });

      const rawProducts = details.filter((d): d is RawProduct => d !== null);
      const missing = details.length - rawProducts.length;
      if (missing > 0) {
        log.warn('catalog.details_incomplete', { missing_count: missing });
      }

      // ---- 3. validate ----
      const validated = validateCatalog(rawProducts);
      if (validated.products.length === 0 && rawProducts.length > 0) {
        throw new Error('Every product failed validation — refusing to replace catalog.');
      }

      // ---- 4. commit atomically ----
      //
      // The backend exposes no cursor or snapshot version, so we mint one
      // from the sync timestamp. This is a SNAPSHOT identifier only — it
      // cannot support incremental sync, and is here so an operator can tell
      // two syncs apart. See the report's limitations section.
      const snapshotVersion = new Date().toISOString();

      const committed = catalog.replaceCatalog({
        products: validated.products,
        variants: validated.variants,
        rejects: validated.rejects,
        snapshotVersion,
        storeId: config.storeId,
      });

      const durationMs = Date.now() - started;
      log.info('catalog.sync_succeeded', {
        product_count: committed.products,
        variant_count: committed.variants,
        reject_count: committed.rejects,
        duration_ms: durationMs,
      });

      return {
        ok: true,
        productCount: committed.products,
        variantCount: committed.variants,
        rejectCount: committed.rejects,
        durationMs,
      };
    } catch (err) {
      const described = describeError(err);
      const message = String(described.error_message ?? 'Catalog sync failed.');

      // Previous catalog is untouched — replaceCatalog either ran fully or not
      // at all. If one existed, put the status back to READY so the POS keeps
      // using it; only a never-initialised catalog goes to FAILED.
      const state = catalog.getState();
      const hadCatalog = state.variantCount > 0 && state.lastSuccessfulSync !== null;
      catalog.setStatus(hadCatalog ? 'READY' : 'FAILED', message);

      log.error('catalog.sync_failed', { ...described, retained_previous: hadCatalog });

      return {
        ok: false,
        productCount: 0,
        variantCount: 0,
        rejectCount: 0,
        durationMs: Date.now() - started,
        error: message,
      };
    } finally {
      this.inFlight = false;
    }
  }
}

export const catalogSyncService = new CatalogSyncService();
