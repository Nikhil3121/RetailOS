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

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  isElectron: true,
  credentials,
} as const;

contextBridge.exposeInMainWorld('retailos', api);

export type RetailOSApi = typeof api;
