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
    sourcemap: true,
  },
});
