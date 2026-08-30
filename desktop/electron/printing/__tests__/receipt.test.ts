/**
 * Phase 9 — receipt formatting and ESC/POS encoding.
 *
 * The receipt is the copy the customer keeps. If it disagrees with SQLite the
 * invariant this whole system is built on is broken on paper, where it is
 * least recoverable. So these tests are mostly about one thing: every printed
 * figure comes from the stored sale and nothing is recalculated.
 */

import { describe, expect, it } from 'vitest';

import { encodeReceipt, toPrintableAscii, CMD } from '../escpos';
import {
  COLUMNS,
  basisPoints,
  centre,
  formatReceipt,
  formatReceiptText,
  paise,
  quantity,
  twoColumn,
  wrap,
  type ReceiptSale,
} from '../receipt-formatter';

/** The shop's real label: MRP 343, 30% off, charged a rounded 240.00. */
const sale = (over: Partial<ReceiptSale> = {}): ReceiptSale => ({
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
  ...over,
});

describe('money is rendered, never computed', () => {
  it('formats paise without dividing', () => {
    expect(paise(24000)).toBe('240.00');
    expect(paise(0)).toBe('0.00');
    expect(paise(5)).toBe('0.05');
    expect(paise(99)).toBe('0.99');
    expect(paise(8_675_309)).toBe('86753.09');
    expect(paise(-250)).toBe('-2.50');
  });

  it('handles the values that break naive float division', () => {
    for (const [value, expected] of [
      [1_005, '10.05'],
      [70_007, '700.07'],
      [999_999_999, '9999999.99'],
    ] as const) {
      expect(paise(value)).toBe(expected);
    }
  });

  it('formats percentages and quantities readably', () => {
    expect(basisPoints(3000)).toBe('30');
    expect(basisPoints(1250)).toBe('12.5');
    expect(basisPoints(0)).toBe('0');
    expect(quantity(1)).toBe('1');
    expect(quantity(2.5)).toBe('2.5');
  });
});

describe('layout', () => {
  it('pushes label and amount to opposite edges', () => {
    const line = twoColumn('Total', '240.00', 32);
    expect(line).toHaveLength(32);
    expect(line.startsWith('Total')).toBe(true);
    expect(line.endsWith('240.00')).toBe(true);
  });

  it('never truncates the amount when space runs out', () => {
    // Money must stay legible even if the label has to give way.
    const line = twoColumn('A'.repeat(60), '1234.00', 32);
    expect(line.endsWith('1234.00')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(32);
  });

  it('wraps long product names instead of cutting them', () => {
    const lines = wrap('LADIES DESIGNER EMBROIDERED COTTON KURTI SET LARGE', 32);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines.join(' ')).toContain('EMBROIDERED');
  });

  it('hard-splits an unbreakable token rather than overflowing', () => {
    const lines = wrap('X'.repeat(80), 32);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines.join('')).toHaveLength(80);
  });

  it('centres without exceeding the roll', () => {
    expect(centre('SHOP', 32).trimStart()).toBe('SHOP');
    expect(centre('X'.repeat(50), 32)).toHaveLength(32);
  });
});

describe('receipt content', () => {
  it('fits 58mm and 80mm rolls', () => {
    for (const width of ['58mm', '80mm'] as const) {
      const lines = formatReceipt(sale(), { width });
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(COLUMNS[width]);
      }
    }
  });

  it('prints the stored total verbatim', () => {
    const text = formatReceiptText(sale());
    expect(text).toContain('240.00');
    // 240.10 is what a naive re-derivation from 343 less 30% would produce.
    expect(text).not.toContain('240.10');
  });

  it('splits CGST and SGST so they sum back to the stored tax exactly', () => {
    // An odd number of paise must not vanish into rounding.
    const lines = formatReceipt(sale({ taxPaise: 1143 }), { width: '80mm' });
    const cgst = lines.find((l) => l.startsWith('CGST'))!;
    const sgst = lines.find((l) => l.startsWith('SGST'))!;

    const value = (line: string): number =>
      Math.round(Number(line.trim().split(/\s+/).pop()) * 100);
    expect(value(cgst) + value(sgst)).toBe(1143);
  });

  it('shows MRP only when it differs from the price charged', () => {
    expect(formatReceiptText(sale())).toContain('MRP');
    // No discount and MRP equal to the price: nothing to show the customer.
    const noSaving = sale({
      items: [
        { ...sale().items[0], mrpPaise: 34300, unitPricePaise: 34300,
          discountPaise: 0, discountPctBp: 0 },
      ],
    });
    expect(formatReceipt(noSaving, {}).filter((l) => l.includes('MRP'))).toHaveLength(0);
  });

  it('carries the offline reference and marks the invoice as pending', () => {
    const text = formatReceiptText(sale(), { showOfflineNotice: true });
    expect(text).toContain('OFFLINE-T1-000042');
    // The notice wraps to the roll width, so match a fragment that cannot
    // straddle a line break rather than the whole sentence.
    expect(text).toMatch(/GST invoice number/i);
  });

  it('shows the server invoice number once it exists', () => {
    const text = formatReceiptText(sale({ invoiceNumber: 'INV-MS-202603-0001' }));
    expect(text).toContain('INV-MS-202603-0001');
    // Both identify the same sale in two systems; staff need to match them.
    expect(text).toContain('OFFLINE-T1-000042');
  });

  it('reports change when the customer overpaid', () => {
    const text = formatReceiptText(
      sale({ payments: [{ method: 'cash', amountPaise: 50000, reference: null }] }),
    );
    expect(text).toContain('Change');
    expect(text).toContain('260.00');
  });

  it('reports balance due on a part payment', () => {
    const text = formatReceiptText(
      sale({ payments: [{ method: 'cash', amountPaise: 10000, reference: null }] }),
    );
    expect(text).toContain('Balance due');
    expect(text).toContain('140.00');
  });

  it('handles a credit sale with no payments at all', () => {
    const text = formatReceiptText(sale({ payments: [] }));
    expect(text).toContain('Balance due');
    expect(text).toContain('240.00');
  });

  it('prints the payment reference for a card or UPI sale', () => {
    const text = formatReceiptText(
      sale({ payments: [{ method: 'upi', amountPaise: 24000, reference: 'UPI-TXN-9931' }] }),
    );
    expect(text).toContain('UPI');
    expect(text).toContain('UPI-TXN-9931');
  });

  it('handles a long multi-item bill on the narrow roll', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      ...sale().items[0],
      productName: `PRODUCT NUMBER ${i} WITH A DELIBERATELY LONG DESCRIPTION`,
      quantity: i + 1,
    }));
    const lines = formatReceipt(sale({ items }), { width: '58mm' });

    expect(lines.length).toBeGreaterThan(50);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('renders awkward money without drift', () => {
    const text = formatReceiptText(
      sale({
        subtotalPaise: 8_262_199,
        taxPaise: 413_110,
        totalPaise: 8_675_309,
        discountPaise: 0,
        items: [
          {
            ...sale().items[0],
            unitPricePaise: 8_675_309,
            lineTotalPaise: 8_675_309,
            discountPaise: 0,
            discountPctBp: 0,
            taxPaise: 413_110,
          },
        ],
        payments: [{ method: 'card', amountPaise: 8_675_309, reference: 'CARD-0042' }],
      }),
    );
    expect(text).toContain('86753.09');
    expect(text).toContain('4131.10');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
  });

  it('renders a fractional quantity', () => {
    const text = formatReceiptText(
      sale({ items: [{ ...sale().items[0], quantity: 2.5 }] }),
    );
    expect(text).toContain('2.5 x');
  });
});

describe('ESC/POS encoding', () => {
  it('always initialises the printer first', () => {
    const bytes = encodeReceipt(['hello']);
    expect(Array.from(bytes.subarray(0, 2))).toEqual([...CMD.INIT]);
  });

  it('ends with a cut by default', () => {
    const bytes = encodeReceipt(['hello']);
    expect(Array.from(bytes.subarray(-3))).toEqual([...CMD.CUT]);
  });

  it('omits the cut when asked', () => {
    const bytes = encodeReceipt(['hello'], { cut: false });
    expect(Array.from(bytes.subarray(-3))).not.toEqual([...CMD.CUT]);
  });

  it('opens the drawer only when asked', () => {
    const withDrawer = encodeReceipt(['x'], { openDrawer: true }).toString('latin1');
    const without = encodeReceipt(['x']).toString('latin1');
    const kick = Buffer.from(CMD.DRAWER_KICK).toString('latin1');
    expect(withDrawer).toContain(kick);
    expect(without).not.toContain(kick);
  });

  it('replaces the rupee sign, which no thermal code page can print', () => {
    expect(toPrintableAscii('₹240.00')).toBe('Rs.240.00');
    expect(toPrintableAscii('a—b')).toBe('a-b');
    expect(toPrintableAscii('“q”')).toBe('"q"');
  });

  it('substitutes rather than corrupting unknown characters', () => {
    // A visible placeholder beats a random glyph on a customer's receipt.
    expect(toPrintableAscii('कुर्ती')).toMatch(/^\?+$/);
  });

  it('emits latin1 bytes, never multi-byte UTF-8', () => {
    const bytes = encodeReceipt(['₹1,234.56']);
    const text = bytes.toString('latin1');
    expect(text).toContain('Rs.1,234.56');
    // Every byte is single-byte printable or a control code.
    for (const byte of bytes) expect(byte).toBeLessThanOrEqual(0xff);
  });

  it('feeds paper before cutting so the tear-off clears the text', () => {
    const bytes = encodeReceipt(['line'], { feedLines: 4 });
    const tail = Array.from(bytes.subarray(-7, -3));
    expect(tail).toEqual([0x0a, 0x0a, 0x0a, 0x0a]);
  });
});
