/**
 * Preload script.
 *
 * The *only* channel between renderer and main. Everything exposed on
 * `window.retailos` must be enumerated here — no `remote`, no IPC pass-through.
 * Milestone 1 exposes only a handful of platform hints; auth/token bridges land
 * in Milestone 2.
 */
import { contextBridge } from 'electron';

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  isElectron: true,
} as const;

contextBridge.exposeInMainWorld('retailos', api);

export type RetailOSApi = typeof api;
