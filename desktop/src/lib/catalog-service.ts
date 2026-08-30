/**
 * Local catalog service — the single renderer entry point to SQLite.
 *
 * Nothing outside this file touches `window.retailos.catalog`. Billing and any
 * future screen import from here, so when the local catalog eventually becomes
 * the primary source there is exactly one place to change.
 *
 * Availability is not assumed. In a browser preview, or when the database
 * failed to initialise, `isAvailable()` is false and every lookup returns null
 * so the caller falls back to the existing HTTP path.
 */

export interface LocalVariant {
  variantId: string;
  serverVariantId: string;
  serverProductId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  hsnCode: string | null;
  taxRateBp: number;
  mrpPaise: number;
  sellingPricePaise: number;
}

export type CatalogStatus = 'NOT_INITIALIZED' | 'SYNCING' | 'READY' | 'FAILED';

export interface CatalogState {
  status: CatalogStatus;
  lastSuccessfulSync: string | null;
  snapshotVersion: string | null;
  productCount: number;
  variantCount: number;
  storeId: string | null;
  error: string | null;
  syncing: boolean;
}

export interface CatalogSyncResult {
  ok: boolean;
  productCount: number;
  variantCount: number;
  rejectCount: number;
  durationMs: number;
  error?: string;
}

/** IPC envelope shared by every main-process handler. */
type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

function bridge() {
  return typeof window !== 'undefined' ? window.retailos?.catalog : undefined;
}

/** True when running inside Electron with the catalog bridge present. */
export function isAvailable(): boolean {
  return bridge() !== undefined;
}

/** Unwrap an envelope, returning `fallback` on any failure. Lookup failures
 *  must never throw into the billing screen — a miss and an error both mean
 *  "not found locally, try the network". */
async function unwrap<T>(
  promise: Promise<Envelope<T>> | undefined,
  fallback: T,
): Promise<T> {
  if (!promise) return fallback;
  try {
    const res = await promise;
    return res.ok ? res.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Scan path: exact barcode, then exact SKU. Returns null when the catalog is
 * unavailable or the code is unknown — the caller then uses the online lookup.
 */
export async function findByCode(code: string): Promise<LocalVariant | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  return unwrap<LocalVariant | null>(bridge()?.findByCode(trimmed), null);
}

export async function findByBarcode(barcode: string): Promise<LocalVariant | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;
  return unwrap<LocalVariant | null>(bridge()?.findByBarcode(trimmed), null);
}

export async function findBySku(sku: string): Promise<LocalVariant | null> {
  const trimmed = sku.trim();
  if (!trimmed) return null;
  return unwrap<LocalVariant | null>(bridge()?.findBySku(trimmed), null);
}

export async function search(query: string, limit = 50): Promise<LocalVariant[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return unwrap<LocalVariant[]>(bridge()?.search(trimmed, limit), []);
}

const UNAVAILABLE: CatalogState = {
  status: 'NOT_INITIALIZED',
  lastSuccessfulSync: null,
  snapshotVersion: null,
  productCount: 0,
  variantCount: 0,
  storeId: null,
  error: null,
  syncing: false,
};

export async function getStatus(): Promise<CatalogState> {
  return unwrap<CatalogState>(bridge()?.getStatus(), UNAVAILABLE);
}

/**
 * Download and replace the local catalog.
 *
 * The main process has no session, so the caller passes the access token from
 * the auth store. The whole operation is atomic on the main side — a failure
 * leaves the previous catalog intact.
 */
export async function syncCatalog(accessToken: string): Promise<CatalogSyncResult> {
  const b = bridge();
  if (!b) {
    return {
      ok: false,
      productCount: 0,
      variantCount: 0,
      rejectCount: 0,
      durationMs: 0,
      error: 'Local catalog is not available outside the desktop app.',
    };
  }
  try {
    const res = (await b.sync(accessToken)) as Envelope<CatalogSyncResult>;
    if (res.ok) return res.data;
    return {
      ok: false,
      productCount: 0,
      variantCount: 0,
      rejectCount: 0,
      durationMs: 0,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      productCount: 0,
      variantCount: 0,
      rejectCount: 0,
      durationMs: 0,
      error: err instanceof Error ? err.message : 'Catalog sync failed.',
    };
  }
}

/** Rupee string for display. Paise is the storage unit; formatting is a view concern. */
export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
