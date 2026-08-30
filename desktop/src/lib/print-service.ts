/**
 * Printing, from the renderer's point of view.
 *
 * ── THE FALLBACK IS THE POINT ──────────────────────────────────────────────
 * A receipt is not a financial record. The sale is committed to SQLite before
 * anything prints, so a printer that is missing, jammed or offline must never
 * block a bill or leave a cashier stuck. Every path here ends somewhere:
 *
 *     thermal printer -> if unavailable or failed -> window.print()
 *
 * `window.print()` is preserved deliberately and is not a temporary shim. A
 * shop with no thermal printer is a supported configuration, not a broken one.
 */

export type PaperWidth = '58mm' | '80mm';
export type PrinterDriver = 'virtual' | 'none';

export interface PrinterStatus {
  driver: PrinterDriver;
  width: PaperWidth;
  ready: boolean;
  message: string;
  outputDir?: string;
  /** Always false. No physical printer has been verified. */
  physicalHardwareVerified: false;
  missingDriver?: string[];
}

export interface PrintResult {
  ok: boolean;
  driver: PrinterDriver;
  attempts: number;
  bytes?: number;
  file?: string;
  error?: string;
  fallbackToBrowser?: boolean;
}

/** How the receipt actually reached paper — reported so the UI can say so. */
export type PrintOutcome =
  | { via: 'thermal'; result: PrintResult }
  | { via: 'browser'; reason: string };

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

function bridge() {
  return typeof window !== 'undefined' ? window.retailos?.printer : undefined;
}

export function isThermalPrintingAvailable(): boolean {
  return bridge() !== undefined;
}

export async function getPrinterStatus(): Promise<PrinterStatus | null> {
  const printer = bridge();
  if (!printer) return null;
  try {
    const res = (await printer.status()) as Envelope<PrinterStatus>;
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}

export async function configurePrinter(config: {
  driver?: PrinterDriver;
  width?: PaperWidth;
}): Promise<PrinterStatus | null> {
  const printer = bridge();
  if (!printer) return null;
  try {
    const res = (await printer.configure(config)) as Envelope<PrinterStatus>;
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}

export async function printTestPage(): Promise<PrintResult | null> {
  const printer = bridge();
  if (!printer) return null;
  try {
    const res = (await printer.test()) as Envelope<PrintResult>;
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}

/**
 * Print a committed sale, falling back to the browser dialog.
 *
 * `browserPrint` is injected rather than calling `window.print()` inline so a
 * test can assert the fallback actually fired — a fallback nobody has ever
 * seen run is not a fallback.
 */
export async function printSaleReceipt(
  saleId: string,
  options: { width?: PaperWidth; openDrawer?: boolean } = {},
  browserPrint: () => void = () => window.print(),
): Promise<PrintOutcome> {
  const printer = bridge();

  if (!printer) {
    browserPrint();
    return { via: 'browser', reason: 'No thermal printing available on this device.' };
  }

  try {
    const res = (await printer.printSale(saleId, options)) as Envelope<PrintResult>;

    if (res.ok && res.data.ok) return { via: 'thermal', result: res.data };

    const reason = res.ok ? res.data.error ?? 'Printing failed.' : res.error;
    // The bill is already saved; the customer still needs paper.
    browserPrint();
    return { via: 'browser', reason };
  } catch (err) {
    browserPrint();
    return {
      via: 'browser',
      reason: err instanceof Error ? err.message : 'Printing failed.',
    };
  }
}
