/**
 * The IPC surface, checked as a whole.
 *
 * The preload bridge and the main-process handlers are written in two different
 * files and are only connected by a string. Nothing in TypeScript relates them,
 * so the two ways they drift both fail quietly:
 *
 *   - A channel exposed with no handler rejects at RUNTIME, and only when a
 *     user happens to reach that feature.
 *   - A handler with no bridge entry is unreachable code that still widens the
 *     attack surface, because it is registered and callable by anything that
 *     gets a foothold in the renderer.
 *
 * Read as source text rather than by importing the modules: `preload.ts` calls
 * `contextBridge.exposeInMainWorld` at import time and `register.ts` expects a
 * live `ipcMain`, so neither can simply be required in a test process.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ELECTRON_DIR = path.resolve(__dirname, '..', '..');

function read(...parts: string[]): string {
  return fs.readFileSync(path.join(ELECTRON_DIR, ...parts), 'utf8');
}

function registeredChannels(): Set<string> {
  const sources = [read('ipc', 'register.ts'), read('main.ts')].join('\n');
  return new Set(
    [...sources.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
}

function exposedChannels(): Set<string> {
  return new Set(
    [...read('preload.ts').matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]),
  );
}

describe('IPC surface', () => {
  it('exposes nothing the main process cannot handle', () => {
    const orphans = [...exposedChannels()].filter((c) => !registeredChannels().has(c));
    expect(orphans).toEqual([]);
  });

  it('registers no handler the renderer cannot reach', () => {
    const unreachable = [...registeredChannels()].filter((c) => !exposedChannels().has(c));
    expect(unreachable).toEqual([]);
  });

  it('found a real surface, so a broken regex cannot pass this file', () => {
    // Without this, a change that made both matchers return nothing would make
    // the two tests above trivially green.
    expect(registeredChannels().size).toBeGreaterThan(20);
    expect(exposedChannels().size).toBeGreaterThan(20);
  });

  it('never exposes a raw SQL or filesystem channel', () => {
    // The boundary's whole design is NAMED OPERATIONS, not a passthrough. A
    // channel called anything like this would defeat it.
    const forbidden = /sql|query:raw|exec|fs:|file:read|shell/i;
    const offenders = [...registeredChannels()].filter((c) => forbidden.test(c));
    expect(offenders).toEqual([]);
  });
});
