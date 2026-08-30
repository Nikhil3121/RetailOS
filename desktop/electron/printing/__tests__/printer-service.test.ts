/**
 * Phase 9 — the printer driver layer.
 *
 * The behaviour that matters is what happens when the printer does NOT work,
 * because that is the state a shop will actually hit: no printer configured,
 * a write that hangs, a device that fails. In every one of those cases the
 * sale is already committed, so the only acceptable outcome is an honest
 * failure that tells the caller to fall back — never a throw, never a hang.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;

vi.mock('electron', () => ({
  app: { getPath: () => tempDir },
  ipcMain: { handle: vi.fn() },
}));

import { PrinterService, describeMissingDriver } from '../printer-service';
import type { ReceiptSale } from '../receipt-formatter';

const sale: ReceiptSale = {
  id: '77777777-7777-4777-8777-777777777777',
  localReference: 'OFFLINE-T1-000042',
  invoiceNumber: null,
  occurredAt: '2026-03-31T18:05:00.000Z',
  createdAt: '2026-03-31T18:05:00.000Z',
  subtotalPaise: 22857,
  discountPaise: 10290,
  taxPaise: 1143,
  totalPaise: 24000,
  notes: null,
  terminalUuid: 'device-1',
  items: [
    {
      productName: 'SHORT KURTI 660',
      sku: '160055.003',
      hsnCode: '6211',
      quantity: 1,
      mrpPaise: 34300,
      unitPricePaise: 34300,
      discountPctBp: 3000,
      discountPaise: 10290,
      taxRateBp: 500,
      taxPaise: 1143,
      lineTotalPaise: 24000,
    },
  ],
  payments: [{ method: 'cash', amountPaise: 24000, reference: null }],
};

let outputDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailos-p9-'));
  outputDir = path.join(tempDir, 'print-jobs');
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const virtual = (over = {}) =>
  new PrinterService({ driver: 'virtual', width: '80mm', outputDir, ...over });

describe('virtual printer', () => {
  it('reports itself ready and writes a job', async () => {
    const printer = virtual();
    expect(printer.status().ready).toBe(true);

    const result = await printer.printSale(sale);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fs.existsSync(result.file!)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('writes a readable twin alongside the bytes', async () => {
    const result = await virtual().printSale(sale);
    const text = fs.readFileSync(`${result.file}.txt`, 'latin1');

    // The receipt content is inspectable without a hex editor.
    expect(text).toContain('SHORT KURTI 660');
    expect(text).toContain('240.00');
    expect(text).toContain('OFFLINE-T1-000042');
  });

  it('prints the stored total, not a re-derived one', async () => {
    const result = await virtual().printSale(sale);
    const text = fs.readFileSync(`${result.file}.txt`, 'latin1');
    expect(text).toContain('240.00');
    expect(text).not.toContain('240.10');
  });

  it('honours the configured paper width', async () => {
    // ESC/POS control sequences (ESC @, ESC E ...) sit inline in the byte
    // stream, so they are stripped before anything is measured — otherwise
    // the '@' of the init sequence counts as a printed column.
    const printedLines = async (width: '58mm' | '80mm'): Promise<string[]> => {
      const result = await virtual({ width }).printSale(sale);
      return fs
        .readFileSync(`${result.file}.txt`, 'latin1')
        .split('\n')
        // eslint-disable-next-line no-control-regex
        .map((line) => line.replace(/\x1b./g, '').replace(/[\x00-\x1f]/g, ''))
        .filter((line) => line.length > 0);
    };

    const narrow = await printedLines('58mm');
    const wide = await printedLines('80mm');

    // Every 58mm line fits the narrow roll...
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(32);
    // ...and the 80mm layout genuinely uses the extra width, which proves the
    // configuration reached the formatter instead of being ignored.
    expect(Math.max(...wide.map((l) => l.length))).toBeGreaterThan(32);
  });

  it('reconfigures between widths at runtime', () => {
    const printer = virtual();
    expect(printer.status().width).toBe('80mm');
    expect(printer.configure({ width: '58mm' }).width).toBe('58mm');
  });

  it('prints a width ruler on the test page', async () => {
    const result = await virtual({ width: '58mm' }).printTestPage();
    expect(result.ok).toBe(true);
    const text = fs.readFileSync(`${result.file}.txt`, 'latin1');
    expect(text).toContain('RetailOS printer test');
    expect(text).toContain('58mm');
  });

  it('fires the cash drawer only when asked', async () => {
    const a = await virtual().printSale(sale, { openDrawer: true });
    const b = await virtual().printSale(sale);
    const kick = '\x1bp\x00\x19\xfa';

    expect(fs.readFileSync(a.file!, 'latin1')).toContain(kick);
    expect(fs.readFileSync(b.file!, 'latin1')).not.toContain(kick);
  });

  it('opens the drawer on its own for a cash sale with no receipt', async () => {
    const result = await virtual().openCashDrawer();
    expect(result.ok).toBe(true);
  });
});

describe('no printer configured', () => {
  const none = () => new PrinterService({ driver: 'none', width: '80mm' });

  it('is reported as not ready, with a plain explanation', () => {
    const status = none().status();
    expect(status.ready).toBe(false);
    expect(status.message).toMatch(/no thermal printer/i);
  });

  it('fails cleanly and asks the caller to fall back', async () => {
    const result = await none().printSale(sale);
    expect(result.ok).toBe(false);
    expect(result.fallbackToBrowser).toBe(true);
    // Not worth retrying something that is not configured.
    expect(result.attempts).toBe(0);
  });

  it('never throws — a receipt failure must not break a committed sale', async () => {
    await expect(none().printSale(sale)).resolves.toBeDefined();
    await expect(none().printTestPage()).resolves.toBeDefined();
    await expect(none().openCashDrawer()).resolves.toBeDefined();
  });
});

describe('failure and retry', () => {
  it('retries a failing write up to the limit, then reports honestly', async () => {
    // The device is PRESENT but every write errors — a printer that is online
    // and out of paper. A destination that is simply absent is a different
    // case: it is caught by the readiness check and not retried at all.
    const printer = virtual({ maxAttempts: 3 });
    vi.spyOn(fs, 'writeFile').mockImplementation(((...args: unknown[]) => {
      (args[2] as (err: Error) => void)(new Error('out of paper'));
    }) as unknown as typeof fs.writeFile);

    const result = await printer.printSale(sale);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.fallbackToBrowser).toBe(true);
    expect(result.error).toMatch(/out of paper/);
    vi.restoreAllMocks();
  });

  it('does not retry a destination that is not there at all', async () => {
    const printer = virtual({ maxAttempts: 3 });
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    fs.writeFileSync(outputDir, 'a file where the directory should be');

    const result = await printer.printSale(sale);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.fallbackToBrowser).toBe(true);
  });

  it('gives up rather than hanging when a write times out', async () => {
    const printer = virtual({ timeoutMs: 1, maxAttempts: 1 });
    // Never calls back: the shape of a printer that accepted the job and
    // went silent.
    vi.spyOn(fs, 'writeFile').mockImplementation((() => {
      /* deliberately never resolves */
    }) as unknown as typeof fs.writeFile);

    const started = Date.now();
    const result = await printer.printSale(sale);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(Date.now() - started).toBeLessThan(2_000);
    vi.restoreAllMocks();
  });

  it('succeeds on a later attempt when the first one fails', async () => {
    const printer = virtual({ maxAttempts: 3 });
    const real = fs.writeFile;
    let calls = 0;
    vi.spyOn(fs, 'writeFile').mockImplementation(((...args: unknown[]) => {
      calls += 1;
      if (calls === 1) {
        const cb = args[2] as (err: Error | null) => void;
        cb(new Error('device busy'));
        return;
      }
      return (real as unknown as (...a: unknown[]) => void)(...args);
    }) as unknown as typeof fs.writeFile);

    const result = await printer.printSale(sale);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    vi.restoreAllMocks();
  });
});

describe('honesty about hardware', () => {
  it('never claims a physical printer was verified', () => {
    for (const driver of ['virtual', 'none'] as const) {
      expect(new PrinterService({ driver }).status().physicalHardwareVerified).toBe(false);
    }
  });

  it('states exactly what is still missing', () => {
    const notes = describeMissingDriver().join(' ');
    expect(notes).toMatch(/not implemented/i);
    expect(notes).toMatch(/no physical printer/i);
  });
});
