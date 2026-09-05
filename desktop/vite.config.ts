import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite config for the React renderer.
 * `base: './'` is required so Electron's `file://` loader resolves assets in prod builds.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Dedicated port for RetailOS. Deliberately NOT Vite's default 5173 —
    // other projects on this machine (retail-cognitive-os, Diginex Media)
    // also run Vite and would otherwise squat 5173 first, causing the
    // Electron shell to load the WRONG app's UI in dev mode.
    // `strictPort` makes a collision fail loudly instead of silently
    // sliding to another port and loading someone else's bundle.
    port: 5273,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Source maps are OPT-IN for packaged builds.
    //
    // `sourcemap: true` shipped a 4.2 MB map inside every installer, which put
    // the app's complete original source on the client's machine — readable by
    // anyone who opens the DevTools this app deliberately leaves available for
    // support. It also made the installer meaningfully larger for no benefit
    // the shop ever sees.
    //
    // Support builds still want them, so set RETAILOS_SOURCEMAP=1 to produce a
    // diagnosable build. Dev is unaffected: `vite` serves maps regardless of
    // this setting, which only applies to `vite build`.
    sourcemap: process.env.RETAILOS_SOURCEMAP === '1',
    // The renderer is one ~1 MB chunk. That is fine here and deliberately not
    // code-split: this is a desktop app loading from the local filesystem, not
    // a website paying for each byte over a network, and a cashier opening the
    // till must never wait on a lazily-fetched route chunk.
    chunkSizeWarningLimit: 1500,
  },
});
