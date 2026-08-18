/**
 * Compile the Electron main process (electron/*.ts → dist-electron/*.js),
 * then drop a package.json in dist-electron declaring the CommonJS module
 * type. That override is required because the outer package.json declares
 * `"type": "module"` (needed for Vite), which would otherwise cause Node to
 * treat the compiled .js files as ES modules and reject their CommonJS output.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Use npx so we hit the locally-installed tsc (Windows needs `npx.cmd`).
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execSync(`${npx} tsc -p electron/tsconfig.json`, { stdio: 'inherit', shell: true });

mkdirSync('dist-electron', { recursive: true });
writeFileSync(
  'dist-electron/package.json',
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);
