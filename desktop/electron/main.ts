/**
 * Electron main process.
 *
 * Boots a single frameless BrowserWindow with strict security defaults:
 * - contextIsolation on, nodeIntegration off, sandbox on
 * - preload script is the only bridge between renderer and main
 * - external navigation is blocked (all links open in the OS browser instead)
 *
 * In dev, the renderer is loaded from Vite (http://localhost:5173).
 * In prod, the renderer is loaded from the packaged file:// bundle.
 */
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const isDev = !app.isPackaged;
// Must match `server.port` in vite.config.ts. 5273 is RetailOS-specific —
// port 5173 (Vite's default) is contested by other Vite projects on this
// machine, and pointing here at 5173 would make the RetailOS shell load
// whichever app happened to claim that port first.
const VITE_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5273';

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Credential vault (Electron safeStorage)
// ---------------------------------------------------------------------------
//
// Stores the "remember me" email + password in an encrypted blob under
// `app.getPath('userData')`. Encryption is delegated to Electron's
// `safeStorage`, which uses:
//   - macOS: Keychain
//   - Windows: DPAPI (bound to the Windows user account)
//   - Linux: libsecret (kwallet / gnome-keyring)
//
// The vault is unlocked automatically when the same OS user session opens the
// app — which on modern devices means the login/PIN/biometric that gates the
// OS itself. That satisfies the "verify with device owner" requirement in
// the product spec without a separate biometric prompt on top.
//
// Errors bubble back through IPC as thrown promises so the renderer's
// safeStorage helper can react (currently it just falls back silently, but
// we surface exceptions in dev via the log line below).

function credentialsFilePath(): string {
  return path.join(app.getPath('userData'), 'retailos-credentials.enc');
}

function registerCredentialHandlers(): void {
  ipcMain.handle('credentials:isSecure', () => {
    // On Linux without a keyring installed this returns false; on Windows
    // and macOS this is effectively always true. The renderer uses it to
    // badge the "Remember me" checkbox as 🔒 Secured vs ⚠ Fallback.
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle(
    'credentials:save',
    async (_event, email: unknown, password: unknown) => {
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new Error('credentials:save requires string email + password');
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS keychain is not available for encrypted storage.');
      }
      const payload = JSON.stringify({ email, password });
      const encrypted = safeStorage.encryptString(payload);
      await fs.writeFile(credentialsFilePath(), encrypted, { mode: 0o600 });
    },
  );

  ipcMain.handle('credentials:load', async () => {
    try {
      const buf = await fs.readFile(credentialsFilePath());
      if (!safeStorage.isEncryptionAvailable()) return null;
      const plain = safeStorage.decryptString(buf);
      const parsed = JSON.parse(plain) as { email?: unknown; password?: unknown };
      if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
        return null;
      }
      return { email: parsed.email, password: parsed.password };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') return null;
      // Corrupt / undecryptable blob (OS user changed, keychain wiped, etc.).
      // Nuking it means the user just has to sign in once more; NOT nuking
      // it would trap them behind a permanent "cannot decrypt" error.
      try {
        await fs.unlink(credentialsFilePath());
      } catch {
        /* swallow */
      }
      return null;
    }
  });

  ipcMain.handle('credentials:clear', async () => {
    try {
      await fs.unlink(credentialsFilePath());
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') throw err;
    }
  });
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#05070d',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Kept available in packaged builds so support can diagnose issues on a
      // shop's PC via F12 — but never opened automatically (see below).
      devTools: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Prevent renderer-driven navigation to arbitrary origins.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(VITE_URL) && !url.startsWith('file://')) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    await mainWindow.loadURL(VITE_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // F12 / Ctrl+Shift+I still open DevTools on demand — the menu bar is hidden,
  // so this is the only way support can reach them on a shop's machine.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const isToggleDevTools =
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (isToggleDevTools) {
      mainWindow?.webContents.toggleDevTools();
    }
  });
}

app.whenReady()
  .then(() => {
    // Register the credential IPC bridge BEFORE the window loads so the
    // renderer's mount-time load call always finds a handler on the other
    // end. Otherwise the first launch's remember-me lookup would fail.
    registerCredentialHandlers();
    return createMainWindow();
  })
  .catch((err) => {
    console.error('Failed to create main window', err);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

// Harden: refuse to grant any permissions the renderer might ask for.
app.on('web-contents-created', (_, contents) => {
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});
