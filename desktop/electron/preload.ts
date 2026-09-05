/**
 * Preload script.
 *
 * The *only* channel between renderer and main. Everything exposed on
 * `window.retailos` must be enumerated here — no `remote`, no IPC pass-through.
 *
 * Bridges currently exposed:
 *   - platform / versions / isElectron    (introspection)
 *   - credentials.{save,load,clear,isSecure}  (Electron safeStorage vault
 *     for the "Remember me" login checkbox — see [renderer] src/lib/remember-me.ts
 *     and [main]     electron/main.ts::registerCredentialHandlers.)
 */
import { contextBridge, ipcRenderer } from 'electron';

const credentials = {
  save(email: string, password: string): Promise<void> {
    return ipcRenderer.invoke('credentials:save', email, password);
  },
  load(): Promise<{ email: string; password: string } | null> {
    return ipcRenderer.invoke('credentials:load');
  },
  clear(): Promise<void> {
    return ipcRenderer.invoke('credentials:clear');
  },
  isSecure(): Promise<boolean> {
    return ipcRenderer.invoke('credentials:isSecure');
  },
};

/**
 * Database + device bridge.
 *
 * Every method maps to ONE named IPC operation. There is deliberately no
 * generic `query(sql)` — the renderer can only invoke the operations listed
 * here, so React cannot execute arbitrary SQL by construction.
 *
 * Each call resolves to `{ ok: true, data }` or `{ ok: false, error }`; the
 * main process never rejects across the boundary with a raw exception.
 */
const db = {
  initialize: () => ipcRenderer.invoke('database:initialize'),
  status: () => ipcRenderer.invoke('database:status'),
  searchProducts: (query: string, limit?: number) =>
    ipcRenderer.invoke('database:products:search', query, limit),
  findProductByCode: (code: string) =>
    ipcRenderer.invoke('database:products:findByCode', code),
  createSale: (sale: unknown) => ipcRenderer.invoke('database:sales:create', sale),
  getSale: (saleId: string) => ipcRenderer.invoke('database:sales:get', saleId),
  listSales: (limit?: number) => ipcRenderer.invoke('database:sales:list', limit),
};

const device = {
  getIdentity: () => ipcRenderer.invoke('device:getIdentity'),
  updateAssignment: (patch: unknown) =>
    ipcRenderer.invoke('device:updateAssignment', patch),
};

const printer = {
  status: () => ipcRenderer.invoke('printer:status'),
  configure: (config: unknown) => ipcRenderer.invoke('printer:configure', config),
  test: () => ipcRenderer.invoke('printer:test'),
  printSale: (saleId: string, options?: unknown) =>
    ipcRenderer.invoke('printer:printSale', saleId, options),
};

/**
 * Shop details for the receipt header, cached locally.
 *
 * Push-only by design: the renderer records what the server told it, and the
 * printer reads it back in the main process. Nothing here reads a store into
 * the renderer, which already has the server for that.
 */
const store = {
  snapshot: (details: unknown) => ipcRenderer.invoke('store:snapshot', details),
};

const backup = {
  list: () => ipcRenderer.invoke('backup:list'),
  verify: (file: string) => ipcRenderer.invoke('backup:verify', file),
  integrity: () => ipcRenderer.invoke('backup:integrity'),
  create: () => ipcRenderer.invoke('backup:create'),
};

const sync = {
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  // Rebuilds and validates payloads without creating a server sale.
  dryRunSales: (limit?: number) => ipcRenderer.invoke('sync:sales:dryRun', limit),
  // Pushes locally committed offline sales. Never called by checkout —
  // billing must never wait on synchronisation.
  runSales: (accessToken: string, limit?: number, apiBaseUrl?: string) =>
    ipcRenderer.invoke('sync:sales:run', accessToken, limit, apiBaseUrl),
};

/**
 * Local catalog (Phase 2). `findByCode` is the scan path — exact barcode,
 * then exact SKU, never fuzzy.
 */
const catalog = {
  getStatus: () => ipcRenderer.invoke('catalog:getStatus'),
  findByBarcode: (barcode: string) => ipcRenderer.invoke('catalog:findByBarcode', barcode),
  findBySku: (sku: string) => ipcRenderer.invoke('catalog:findBySku', sku),
  findByCode: (code: string) => ipcRenderer.invoke('catalog:findByCode', code),
  search: (query: string, limit?: number) =>
    ipcRenderer.invoke('catalog:search', query, limit),
  sync: (accessToken: string) => ipcRenderer.invoke('catalog:sync', accessToken),
};

const config = {
  get: () => ipcRenderer.invoke('config:get'),
};

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  isElectron: true,
  credentials,
  db,
  device,
  sync,
  backup,
  printer,
  config,
  catalog,
  store,
} as const;

contextBridge.exposeInMainWorld('retailos', api);

export type RetailOSApi = typeof api;
