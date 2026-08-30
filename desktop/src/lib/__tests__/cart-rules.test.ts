/**
 * Duplicate-BARCODE rule tests.
 *
 * The rule is barcode-specific: only a scanner reading the same barcode twice
 * into the same bill is refused. Typed SKUs and picker clicks keep the
 * pre-existing increment behaviour.
 *
 * These cover the DECISION, which is where the rule lives. The cart mutation
 * itself is unchanged Billing.tsx code — deliberately not re-implemented here,
 * because doing so would be the "second cart implementation" the requirement
 * warns against.
 */

import { describe, expect, it } from 'vitest';

import { decideAdd, DUPLICATE_SCAN_MESSAGE, type CartLineLike } from '../cart-rules';

const line = (variantId: string): CartLineLike => ({ variant_id: variantId });

const SHIRT = '11111111-1111-4111-8111-111111111111';
const SAREE = '22222222-2222-4222-8222-222222222222';

describe('1. same barcode scanned twice is blocked', () => {
  it('first scan adds', () => {
    expect(decideAdd([], SHIRT, 'barcode-scan')).toEqual({ action: 'add' });
  });

  it('second scan is rejected', () => {
    expect(decideAdd([line(SHIRT)], SHIRT, 'barcode-scan').action).toBe('reject');
  });

  it('rejected, not incremented — Shirt x 1 stays Shirt x 1', () => {
    const decision = decideAdd([line(SHIRT)], SHIRT, 'barcode-scan');
    expect(decision.action).not.toBe('increment');
    expect(decision.action).not.toBe('add');
  });

  it('stays rejected however many times it is scanned', () => {
    for (let i = 0; i < 5; i++) {
      expect(decideAdd([line(SHIRT)], SHIRT, 'barcode-scan').action).toBe('reject');
    }
  });

  it('carries cashier-facing feedback and a machine-readable reason', () => {
    const decision = decideAdd([line(SHIRT)], SHIRT, 'barcode-scan');
    if (decision.action !== 'reject') throw new Error('expected a rejection');
    expect(decision.message).toBe(DUPLICATE_SCAN_MESSAGE);
    expect(decision.message).toBe('Already in this bill');
    expect(decision.reason).toBe('duplicate-barcode-scan');
  });
});

describe('2. a different barcode is still added', () => {
  it('adds a second, different product', () => {
    expect(decideAdd([line(SHIRT)], SAREE, 'barcode-scan')).toEqual({ action: 'add' });
  });

  it('one rejection does not block later distinct scans', () => {
    const cart = [line(SHIRT)];
    expect(decideAdd(cart, SHIRT, 'barcode-scan').action).toBe('reject');
    expect(decideAdd(cart, SAREE, 'barcode-scan').action).toBe('add');
  });

  it('adds when the cart holds only other products', () => {
    expect(decideAdd([line(SAREE)], SHIRT, 'barcode-scan')).toEqual({ action: 'add' });
  });
});

describe('3. same SKU typed twice keeps existing behaviour', () => {
  it('a typed SKU for an existing line increments, it does not reject', () => {
    // THE CORRECTION: manual SKU entry is not a scan.
    expect(decideAdd([line(SHIRT)], SHIRT, 'manual')).toEqual({ action: 'increment' });
  });

  it('typing the same SKU repeatedly keeps incrementing', () => {
    for (let i = 0; i < 3; i++) {
      expect(decideAdd([line(SHIRT)], SHIRT, 'manual').action).toBe('increment');
    }
  });

  it('a typed SKU for a new product still adds', () => {
    expect(decideAdd([line(SAREE)], SHIRT, 'manual')).toEqual({ action: 'add' });
  });
});

describe('4. same picker product clicked twice keeps existing behaviour', () => {
  it('a repeat picker click increments', () => {
    expect(decideAdd([line(SHIRT)], SHIRT, 'manual')).toEqual({ action: 'increment' });
  });

  it('click-to-build-quantity still works across several clicks', () => {
    // Picker clicks call addVariant(v) with the 'manual' default. This is how
    // cashiers add multiples today and it must not regress.
    const cart = [line(SHIRT)];
    expect(decideAdd(cart, SHIRT, 'manual').action).toBe('increment');
    expect(decideAdd(cart, SHIRT, 'manual').action).toBe('increment');
  });
});

describe('5. a new bill accepts the same barcode again', () => {
  it('rejected on the old bill, accepted on an empty one', () => {
    expect(decideAdd([line(SHIRT)], SHIRT, 'barcode-scan').action).toBe('reject');
    // Nothing marks the barcode as consumed anywhere — the rule reads only
    // the lines it is handed.
    expect(decideAdd([], SHIRT, 'barcode-scan')).toEqual({ action: 'add' });
  });

  it('holds no state between calls', () => {
    for (let i = 0; i < 20; i++) {
      expect(decideAdd([], SHIRT, 'barcode-scan')).toEqual({ action: 'add' });
    }
  });
});

describe('6. manual quantity editing is unaffected', () => {
  it('the rule never reports a quantity change of its own', () => {
    // decideAdd only ever says add / increment / reject. It has no opinion
    // about the quantity controls, which remain Billing.tsx's updateLine().
    const decision = decideAdd([line(SHIRT)], SHIRT, 'barcode-scan');
    expect(Object.keys(decision)).not.toContain('quantity');
  });

  it('never mutates the lines it is given', () => {
    const cart = [line(SHIRT), line(SAREE)];
    const snapshot = JSON.stringify(cart);
    decideAdd(cart, SHIRT, 'barcode-scan');
    decideAdd(cart, SHIRT, 'manual');
    decideAdd(cart, 'new-id', 'barcode-scan');
    expect(JSON.stringify(cart)).toBe(snapshot);
  });
});

describe('7. no regression in existing cart behaviour', () => {
  it('matches on variant_id, not product name', () => {
    // Two sizes of the same shirt are different variants and different lines.
    expect(decideAdd([line(SHIRT)], SAREE, 'barcode-scan')).toEqual({ action: 'add' });
  });

  it('handles a large cart without special-casing', () => {
    const big = Array.from({ length: 500 }, (_, i) => line(`variant-${i}`));
    expect(decideAdd(big, 'variant-499', 'barcode-scan').action).toBe('reject');
    expect(decideAdd(big, 'variant-500', 'barcode-scan').action).toBe('add');
  });

  it('an empty cart always adds, whatever the source', () => {
    expect(decideAdd([], SHIRT, 'barcode-scan').action).toBe('add');
    expect(decideAdd([], SHIRT, 'manual').action).toBe('add');
  });
});
