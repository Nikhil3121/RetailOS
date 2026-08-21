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
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;
const VITE_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

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
      devTools: true,   // enabled in packaged builds so cashiers/support can debug
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
    // Auto-open DevTools on packaged launch — makes it easy to diagnose
    // "unable to reach server" and similar issues from any Windows PC.
    // Remove this line once we're happy the app is stable in production.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Register global keyboard shortcuts so F12 / Ctrl+Shift+I always work,
  // even if the menu bar is hidden.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const isToggleDevTools =
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (isToggleDevTools) {
      mainWindow?.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(createMainWindow).catch((err) => {
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
