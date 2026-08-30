import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Main-process tests only.
 *
 * The renderer has no test setup yet and adding jsdom here would pull a large
 * dependency in for files this config does not cover. Scope is limited to
 * `electron/` so the suite stays fast and this phase does not touch the
 * renderer's build.
 */
export default defineConfig({
  resolve: {
    // Match the Vite alias so renderer modules can be imported by their
    // '@/...' path in tests exactly as they are in the app.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    // Renderer coverage is limited to PURE modules under src/lib. Component
    // tests would need jsdom and React Testing Library; that is a larger
    // change than this rule warrants, so the cart rule was extracted into a
    // pure function precisely so it can be tested without rendering.
    include: [
      'electron/**/__tests__/**/*.test.ts',
      'src/lib/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    // better-sqlite3 is a native module — it cannot be bundled or run in a
    // worker pool that reloads it per file.
    pool: 'forks',
    testTimeout: 15_000,
  },
});
