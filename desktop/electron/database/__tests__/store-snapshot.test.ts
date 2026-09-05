/**
 * The shop on the receipt.
 *
 * A till receipt without the supplier's GSTIN is not a tax invoice. Before
 * migration 008 nothing populated the local `store` table, so every thermal
 * receipt printed the built-in default and carried no shop identity at all.
 *
 * These tests pin the two properties that keep that from coming back: the
 * snapshot survives a refresh without duplicating the store, and what the
 * printer reads back is what the server actually said.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let tempDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tempDir },
  ipcMain: { handle: vi.fn() },
}));

import { closeDatabase, openDatabase } from '../connection';
import { runMigrations } from '../migrations';
import { StoreRepository } from '../repositories/store-repository';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';

function freshDb() {
  const db = openDatabase(path.join(tempDir, `store-${randomUUID()}.db`));
  runMigrations(db);
  return db;
}

const details = (over: Record<string, unknown> = {}) => ({
  serverId: SERVER_ID,
  code: 'TR',
  name: 'M.S. Mall — Thana Road',
  gstin: '09ABCDE1234F1Z5',
  address: 'Thana Road\nMadanpur',
  phone: '9876543210',
  receiptMessage: 'M.S. wishes you a happy Holi',
  ...over,
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-store-'));
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('store snapshot', () => {
  it('records what the server said', () => {
    const repo = new StoreRepository(freshDb());
    repo.snapshot(details());

    const found = repo.findByServerId(SERVER_ID);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('M.S. Mall — Thana Road');
    expect(found?.gstin).toBe('09ABCDE1234F1Z5');
    expect(found?.receiptMessage).toBe('M.S. wishes you a happy Holi');
  });

  it('updates in place rather than inserting a second row', () => {
    const db = freshDb();
    const repo = new StoreRepository(db);
    repo.snapshot(details());
    repo.snapshot(details({ name: 'M.S. Mall — GT Road', receiptMessage: 'Thank you, visit again' }));

    const rows = db.prepare('SELECT COUNT(*) AS n FROM store').get() as { n: number };
    expect(rows.n).toBe(1);
    expect(repo.findByServerId(SERVER_ID)?.name).toBe('M.S. Mall — GT Road');
    expect(repo.findByServerId(SERVER_ID)?.receiptMessage).toBe('Thank you, visit again');
  });

  it('matches on the server id, so renaming a branch does not fork the row', () => {
    const db = freshDb();
    const repo = new StoreRepository(db);
    const first = repo.snapshot(details());
    // Both the code and the name change — everything except server identity.
    const second = repo.snapshot(details({ code: 'GT', name: 'Renamed' }));

    expect(second.id).toBe(first.id);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM store').get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('keeps the two branches apart — they file under separate GSTINs', () => {
    const repo = new StoreRepository(freshDb());
    const other = '22222222-2222-4222-8222-222222222222';
    repo.snapshot(details());
    repo.snapshot(details({ serverId: other, code: 'GT', gstin: '09ZZZZZ9999Z9Z9' }));

    expect(repo.findByServerId(SERVER_ID)?.gstin).toBe('09ABCDE1234F1Z5');
    expect(repo.findByServerId(other)?.gstin).toBe('09ZZZZZ9999Z9Z9');
  });

  it('returns null for a store that has never been synced', () => {
    const repo = new StoreRepository(freshDb());
    expect(repo.findByServerId(SERVER_ID)).toBeNull();
  });

  it('accepts a shop that has no message, GSTIN or phone yet', () => {
    const repo = new StoreRepository(freshDb());
    repo.snapshot({ serverId: SERVER_ID, code: 'TR', name: 'M.S. Mall' });

    const found = repo.findByServerId(SERVER_ID);
    expect(found?.name).toBe('M.S. Mall');
    expect(found?.gstin).toBeNull();
    expect(found?.receiptMessage).toBeNull();
  });
});
