/**
 * Printing, behind one interface.
 *
 * ── WHY AN ABSTRACTION ─────────────────────────────────────────────────────
 * Billing and LocalInvoice previously called `window.print()` directly, which
 * ties the receipt to a browser print dialog and an A5 page. A thermal roll is
 * a different device with a different failure model: it runs out of paper, it
 * goes offline, it times out. Those states have to be reportable, so printing
 * goes through a driver interface rather than a global function.
 *
 * ── WHAT IS AND IS NOT IMPLEMENTED ─────────────────────────────────────────
 * Two drivers exist and are exercised by tests:
 *
 *   virtual  writes the exact bytes to a file. This is what the automated
 *            tests print to, and what a shop can use to prove the pipeline
 *            works before hardware arrives.
 *   none     no printer configured; every job fails cleanly so the caller
 *            falls back to window.print().
 *
 * A real USB/serial/network driver is NOT implemented, because no physical
 * printer has been available to develop against and a driver written blind
 * would be untested code pretending to be a feature. `describeMissingDriver`
 * states exactly what remains, so the gap is visible rather than implied.
 *
 * ── RETRY ──────────────────────────────────────────────────────────────────
 * A receipt is not a financial record — the sale is already committed to
 * SQLite before anything prints. So a failed print must never block, roll back
 * or alter a sale. It retries a bounded number of times and then reports
 * honestly, leaving the operator to reprint.
 */

import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { describeError, log } from '../database/logger';
import { encodeDrawerKick, encodeReceipt, type EncodeOptions } from './escpos';
import {
  formatReceipt,
  type FormatOptions,
  type PaperWidth,
  type ReceiptSale,
} from './receipt-formatter';

export type DriverKind = 'virtual' | 'none';

export interface PrinterConfig {
  driver: DriverKind;
  width: PaperWidth;
  /** Where the virtual driver writes. Defaults under userData. */
  outputDir?: string;
  /** Milliseconds a single attempt may take before it is abandoned. */
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface PrintResult {
  ok: boolean;
  driver: DriverKind;
  attempts: number;
  bytes?: number;
  /** Virtual driver only: where the job landed. */
  file?: string;
  error?: string;
  /** True when the caller should fall back to window.print(). */
  fallbackToBrowser?: boolean;
}

export interface PrinterStatus {
  driver: DriverKind;
  width: PaperWidth;
  ready: boolean;
  /** Plain-English state for the diagnostics screen. */
  message: string;
  outputDir?: string;
  physicalHardwareVerified: false;
}

const DEFAULTS: Required<Pick<PrinterConfig, 'timeoutMs' | 'maxAttempts'>> = {
  timeoutMs: 5_000,
  maxAttempts: 3,
};

/** A destination that can accept a byte stream. */
interface Driver {
  readonly kind: DriverKind;
  isReady(): boolean;
  describe(): string;
  write(bytes: Buffer, timeoutMs: number): Promise<{ bytes: number; file?: string }>;
}

/**
 * Writes jobs to disk instead of paper.
 *
 * Not a stub for tests alone: it lets a shop verify formatting, widths and the
 * whole print path before a printer is ever plugged in, and it gives support a
 * byte-exact artefact when a receipt comes out wrong.
 */
class VirtualPrinter implements Driver {
  readonly kind = 'virtual' as const;

  constructor(private readonly dir: string) {}

  isReady(): boolean {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  describe(): string {
    return `Virtual printer writing to ${this.dir}`;
  }

  async write(bytes: Buffer, timeoutMs: number): Promise<{ bytes: number; file?: string }> {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(
      this.dir,
      `receipt-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`,
    );

    // Even a local write is raced against the timeout, so the timeout path is
    // the same code in test and in production rather than an untested branch.
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        fs.writeFile(file, bytes, (err) => (err ? reject(err) : resolve()));
      }),
      timeoutMs,
    );

    // The human-readable twin, so a formatting problem can be read directly.
    try {
      fs.writeFileSync(`${file}.txt`, bytes.toString('latin1'));
    } catch {
      /* the bytes are what matter */
    }

    return { bytes: bytes.length, file };
  }
}

/** No printer configured. Fails cleanly so the caller can fall back. */
class NoPrinter implements Driver {
  readonly kind = 'none' as const;
  isReady(): boolean {
    return false;
  }
  describe(): string {
    return 'No thermal printer configured. Receipts print through the browser dialog.';
  }
  async write(): Promise<{ bytes: number }> {
    throw new Error('No printer configured.');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Printer timed out.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class PrinterService {
  private config: PrinterConfig;
  private driver: Driver;

  constructor(config?: Partial<PrinterConfig>) {
    this.config = {
      driver: (process.env.RETAILOS_PRINTER_DRIVER as DriverKind) ?? 'none',
      width: (process.env.RETAILOS_PRINTER_WIDTH as PaperWidth) ?? '80mm',
      ...config,
    };
    this.driver = this.buildDriver();
  }

  private buildDriver(): Driver {
    if (this.config.driver === 'virtual') {
      return new VirtualPrinter(this.config.outputDir ?? this.defaultOutputDir());
    }
    return new NoPrinter();
  }

  private defaultOutputDir(): string {
    try {
      return path.join(app.getPath('userData'), 'print-jobs');
    } catch {
      return path.join(process.cwd(), 'print-jobs');
    }
  }

  configure(config: Partial<PrinterConfig>): PrinterStatus {
    this.config = { ...this.config, ...config };
    this.driver = this.buildDriver();
    return this.status();
  }

  status(): PrinterStatus {
    const ready = this.driver.isReady();
    return {
      driver: this.driver.kind,
      width: this.config.width,
      ready,
      message: this.driver.describe(),
      outputDir: this.driver.kind === 'virtual' ? this.config.outputDir ?? this.defaultOutputDir() : undefined,
      // Stated in the type, not just in prose: nothing here has touched a real
      // printer, and no screen should imply otherwise.
      physicalHardwareVerified: false,
    };
  }

  /** Render a sale and send it. Never throws — callers are printing a receipt
   *  for a sale that is already safely committed. */
  async printSale(
    sale: ReceiptSale,
    options: FormatOptions & EncodeOptions = {},
  ): Promise<PrintResult> {
    const lines = formatReceipt(sale, {
      width: this.config.width,
      showOfflineNotice: true,
      ...options,
    });
    return this.printLines(lines, options);
  }

  async printLines(lines: string[], options: EncodeOptions = {}): Promise<PrintResult> {
    const bytes = encodeReceipt(lines, { boldHeader: true, ...options });
    return this.send(bytes);
  }

  /** A short self-test page for the diagnostics screen. */
  async printTestPage(): Promise<PrintResult> {
    const width = this.config.width;
    const columns = width === '58mm' ? 32 : 48;
    return this.printLines([
      'RetailOS printer test',
      '-'.repeat(columns),
      `Paper width: ${width} (${columns} columns)`,
      `Driver: ${this.driver.kind}`,
      new Date().toLocaleString('en-IN'),
      '-'.repeat(columns),
      // A ruler: if the digits wrap, the configured width is wrong.
      Array.from({ length: columns }, (_, i) => String((i + 1) % 10)).join(''),
      'Rs.1,234.56  GST 5%  ABCDEFGHIJKLM',
      '-'.repeat(columns),
      'If this line is complete, the width is correct.',
    ]);
  }

  async openCashDrawer(): Promise<PrintResult> {
    return this.send(encodeDrawerKick());
  }

  /**
   * Send bytes, retrying transient failures.
   *
   * Bounded and honest: after the last attempt it reports failure and asks the
   * caller to fall back to the browser dialog, rather than retrying forever
   * while a cashier waits with a customer in front of them.
   */
  private async send(bytes: Buffer): Promise<PrintResult> {
    const maxAttempts = this.config.maxAttempts ?? DEFAULTS.maxAttempts;
    const timeoutMs = this.config.timeoutMs ?? DEFAULTS.timeoutMs;

    if (!this.driver.isReady()) {
      return {
        ok: false,
        driver: this.driver.kind,
        attempts: 0,
        error: this.driver.describe(),
        fallbackToBrowser: true,
      };
    }

    let lastError = 'Printing failed.';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const written = await this.driver.write(bytes, timeoutMs);
        log.info('print.completed', {
          driver: this.driver.kind,
          attempts: attempt,
          bytes: written.bytes,
        });
        return {
          ok: true,
          driver: this.driver.kind,
          attempts: attempt,
          bytes: written.bytes,
          file: written.file,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Printing failed.';
        log.warn('print.attempt_failed', { attempt, error_message: lastError });
      }
    }

    log.error('print.failed', describeError(new Error(lastError)));
    return {
      ok: false,
      driver: this.driver.kind,
      attempts: maxAttempts,
      error: lastError,
      fallbackToBrowser: true,
    };
  }
}

/**
 * What a real printer still needs.
 *
 * Surfaced through the diagnostics screen so the remaining work is visible to
 * whoever installs the hardware, instead of being discovered on the day.
 */
export function describeMissingDriver(): string[] {
  return [
    'A USB / serial / network ESC-POS driver is not implemented — no physical printer was available to develop against.',
    'Receipt layout, ESC/POS encoding, retry and failure handling ARE implemented and tested against the virtual printer.',
    'When hardware arrives: add a driver that writes the same byte stream to the device, and set RETAILOS_PRINTER_DRIVER.',
  ];
}

export const printerService = new PrinterService();
