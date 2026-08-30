/**
 * Local-first checkout tests — the money-moving path.
 *
 * These verify the CONVERSION and VALIDATION boundary, which is where money
 * changes representation (float rupees -> integer paise). The atomic commit
 * itself is covered against real SQLite in electron/database/__tests__.
 */

import { describe, expect, it } from 'vitest';

import {
  computeLineMoney,
  percentToBasisPoints,
  rupeesToPaise,
  validateCheckout,
  type CheckoutLine,
  type LocalCheckoutInput,
} from '../local-checkout';

const line = (over: Partial<CheckoutLine> = {}): CheckoutLine => ({
  variant_id: '11111111-1111-4111-8111-111111111111',
  sku: 'SKU-1',
  product_name: 'Cotton Shirt',
  variant_name: 'M / Blue',
  unit_price: '899.00',
  tax_rate: '5',
  quantity: 1,
  discount_pct: 0,
  ...over,
});

const input = (over: Partial<LocalCheckoutInput> = {}): LocalCheckoutInput => ({
  clientUuid: '22222222-2222-4222-8222-222222222222',
  lines: [line()],
  totals: { gross: 899, discount: 0, subtotal: 856.19, tax: 42.81, grand: 899 },
  paymentMethod: 'cash',
  amountPaid: 899,
  storeId: 'store-1',
  terminalId: null,
  customerId: null,
  salespersonUserId: null,
  paymentReference: null,
  notes: null,
  ...over,
});

describe('money conversion', () => {
  it('converts rupees to integer paise', () => {
    expect(rupeesToPaise(899)).toBe(89900);
    expect(rupeesToPaise(899.5)).toBe(89950);
    expect(rupeesToPaise(0)).toBe(0);
  });

  it('never returns a fractional paise value', () => {
    for (const v of [1.005, 10.555, 0.1, 0.2, 33.333, 1 / 3]) {
      expect(Number.isInteger(rupeesToPaise(v))).toBe(true);
    }
  });

  it('handles the classic float artefact without losing a paisa', () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE-754. A naive Math.round
    // would give 100; the epsilon guard gives 101.
    expect(rupeesToPaise(1.005)).toBe(101);
  });

  it('is defensive about non-finite input', () => {
    expect(rupeesToPaise(NaN)).toBe(0);
    expect(rupeesToPaise(Infinity)).toBe(0);
  });

  it('converts percentages to basis points', () => {
    expect(percentToBasisPoints(5)).toBe(500);
    expect(percentToBasisPoints(12.5)).toBe(1250);
    expect(percentToBasisPoints(0)).toBe(0);
  });
});

describe('line money mirrors the existing GST formula', () => {
  it('computes tax-inclusive GST for a simple line', () => {
    // 899.00 at 5% inclusive: net = 899/1.05 = 856.19, tax = 42.81
    const m = computeLineMoney(line());
    expect(m.lineTotalPaise).toBe(89900);
    expect(m.taxRateBp).toBe(500);
    expect(m.taxPaise).toBe(4281);
  });

  it('applies a percentage discount before deriving tax', () => {
    const m = computeLineMoney(line({ discount_pct: 10 }));
    // gross 899, discount 89.90, lineTotal 809.10
    expect(m.discountPaise).toBe(8990);
    expect(m.lineTotalPaise).toBe(80910);
  });

  it('multiplies by quantity', () => {
    const m = computeLineMoney(line({ quantity: 3 }));
    expect(m.lineTotalPaise).toBe(269700);
  });

  it('handles fractional quantity (fabric by the metre)', () => {
    const m = computeLineMoney(line({ unit_price: '100.00', quantity: 2.5, tax_rate: '0' }));
    expect(m.lineTotalPaise).toBe(25000);
  });

  it('handles a zero tax rate without dividing by zero', () => {
    const m = computeLineMoney(line({ tax_rate: '0' }));
    expect(m.taxPaise).toBe(0);
    expect(m.lineTotalPaise).toBe(89900);
  });

  it('handles a 100% discount', () => {
    const m = computeLineMoney(line({ discount_pct: 100 }));
    expect(m.lineTotalPaise).toBe(0);
    expect(m.taxPaise).toBe(0);
  });
});

describe('checkout validation', () => {
  it('accepts a well-formed bill', () => {
    expect(validateCheckout(input())).toHaveLength(0);
  });

  it('rejects an empty cart', () => {
    const problems = validateCheckout(input({ lines: [] }));
    expect(problems.some((p) => p.field === 'lines')).toBe(true);
  });

  it('rejects zero or negative quantity', () => {
    expect(validateCheckout(input({ lines: [line({ quantity: 0 })] })).length).toBeGreaterThan(0);
    expect(validateCheckout(input({ lines: [line({ quantity: -1 })] })).length).toBeGreaterThan(0);
  });

  it('rejects a negative price', () => {
    const problems = validateCheckout(input({ lines: [line({ unit_price: '-10' })] }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range discount', () => {
    expect(validateCheckout(input({ lines: [line({ discount_pct: 101 })] })).length).toBeGreaterThan(0);
    expect(validateCheckout(input({ lines: [line({ discount_pct: -5 })] })).length).toBeGreaterThan(0);
  });

  it('rejects a negative amount paid', () => {
    const problems = validateCheckout(input({ amountPaid: -100 }));
    expect(problems.some((p) => p.field === 'amountPaid')).toBe(true);
  });

  it('allows partial payment — the shortfall becomes balance due', () => {
    // A bill paid short is legitimate (khata/credit). It must not be blocked.
    expect(validateCheckout(input({ amountPaid: 100 }))).toHaveLength(0);
  });

  it('allows zero payment for a fully-credit bill', () => {
    expect(validateCheckout(input({ amountPaid: 0 }))).toHaveLength(0);
  });

  it('names the offending product so the cashier can fix it', () => {
    const problems = validateCheckout(
      input({ lines: [line({ product_name: 'Silk Saree', quantity: 0 })] }),
    );
    expect(problems[0].message).toContain('Silk Saree');
  });
});
