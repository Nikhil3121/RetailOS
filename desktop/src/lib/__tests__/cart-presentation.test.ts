/**
 * Cart presentation — what the cashier and customer see.
 *
 * Presentation, but of money, so the cases that matter are the ones where a
 * plausible-looking number would be wrong: a saving that is really a markup,
 * an unknown MRP shown as a zero saving, and a line total that must keep
 * agreeing with what the bill charges.
 */

import { describe, expect, it } from 'vitest';

import {
  cashSuggestions,
  presentLine,
  summariseSavings,
  type PresentableLine,
} from '../cart-presentation';

/** The shop's real label: MRP 343, 30% off. */
const line = (over: Partial<PresentableLine> = {}): PresentableLine => ({
  unit_price: '343.00',
  mrp: '343.00',
  quantity: 1,
  discount_pct: 30,
  ...over,
});

describe('line presentation', () => {
  it('matches the arithmetic the bill already uses', () => {
    const p = presentLine(line());
    expect(p.gross).toBe(343);
    expect(p.discountAmount).toBe(102.9);
    expect(p.lineTotal).toBe(240.1);
  });

  it('shows the saving against MRP', () => {
    const p = presentLine(line());
    expect(p.mrpTotal).toBe(343);
    expect(p.savedAgainstMrp).toBe(102.9);
    expect(p.showsSaving).toBe(true);
  });

  it('multiplies MRP by quantity', () => {
    const p = presentLine(line({ quantity: 3 }));
    expect(p.mrpTotal).toBe(1029);
    expect(p.lineTotal).toBe(720.3);
    expect(p.savedAgainstMrp).toBe(308.7);
  });

  it('says nothing when the MRP is unknown', () => {
    // "We cannot tell you the saving" and "there is no saving" are different
    // statements; showing 0.00 for the first would be a small lie.
    for (const mrp of [null, undefined]) {
      const p = presentLine(line({ mrp }));
      expect(p.savedAgainstMrp).toBeNull();
      expect(p.showsSaving).toBe(false);
    }
  });

  it('reports no saving when MRP equals what is charged', () => {
    const p = presentLine(line({ discount_pct: 0 }));
    expect(p.savedAgainstMrp).toBe(0);
    expect(p.showsSaving).toBe(false);
  });

  it('never advertises a markup as a saving', () => {
    // Sold ABOVE the printed MRP. Whatever else that is, it is not a discount.
    const p = presentLine(line({ unit_price: '400.00', mrp: '343.00', discount_pct: 0 }));
    expect(p.savedAgainstMrp).toBe(0);
    expect(p.showsSaving).toBe(false);
  });

  it('handles a zero or malformed MRP without inventing one', () => {
    for (const mrp of ['0', '0.00', 'not a number', '']) {
      expect(presentLine(line({ mrp })).savedAgainstMrp).toBeNull();
    }
  });

  it('handles a fractional quantity', () => {
    const p = presentLine(line({ unit_price: '129.99', mrp: '160.00', quantity: 2.5, discount_pct: 12.5 }));
    expect(p.gross).toBe(324.98);
    // 284.35, matching what computeLineMoney stores — NOT 284.36, which is
    // what rounding the gross first would have produced.
    expect(p.lineTotal).toBe(284.35);
    expect(p.mrpTotal).toBe(400);
    expect(p.savedAgainstMrp).toBe(115.65);
  });

  it('handles a zero-price line without dividing by anything', () => {
    const p = presentLine(line({ unit_price: '0', mrp: null, discount_pct: 0 }));
    expect(p.lineTotal).toBe(0);
    expect(Number.isNaN(p.lineTotal)).toBe(false);
  });
});

describe('bill savings', () => {
  it('adds up savings across lines', () => {
    const s = summariseSavings([line(), line({ quantity: 2 })]);
    // Written as a literal on purpose: `102.9 + 205.8` is 308.70000000000005
    // in IEEE-754, and the running total is rounded precisely so the figure
    // shown to a customer is not that.
    expect(s.totalSaved).toBe(308.7);
    expect(s.linesWithSaving).toBe(2);
    expect(s.known).toBe(true);
  });

  it('stays silent when no line has an MRP', () => {
    // The screen shows nothing rather than a confident "You saved Rs.0.00".
    const s = summariseSavings([line({ mrp: null }), line({ mrp: null })]);
    expect(s.known).toBe(false);
    expect(s.totalSaved).toBe(0);
  });

  it('counts only the lines that actually saved something', () => {
    const s = summariseSavings([line(), line({ discount_pct: 0 })]);
    expect(s.linesWithSaving).toBe(1);
    expect(s.totalSaved).toBe(102.9);
    // An MRP was present, so the total is meaningful even though one line
    // contributed nothing.
    expect(s.known).toBe(true);
  });

  it('handles an empty cart', () => {
    expect(summariseSavings([])).toEqual({ totalSaved: 0, linesWithSaving: 0, known: false });
  });
});

describe('cash suggestions', () => {
  it('always offers the exact amount first', () => {
    expect(cashSuggestions(240.1)[0]).toBe(240.1);
  });

  it('offers the round notes a customer would actually hand over', () => {
    const suggestions = cashSuggestions(240.1);
    expect(suggestions).toContain(250);
    expect(suggestions).toContain(300);
    expect(suggestions).toContain(500);
  });

  it('never suggests less than the bill', () => {
    for (const total of [1, 49.5, 240.1, 1999, 4321]) {
      for (const suggestion of cashSuggestions(total)) {
        expect(suggestion).toBeGreaterThanOrEqual(Math.round(total * 100) / 100);
      }
    }
  });

  it('does not repeat the exact amount when it is already round', () => {
    const suggestions = cashSuggestions(500);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions[0]).toBe(500);
  });

  it('offers nothing for an empty or invalid bill', () => {
    expect(cashSuggestions(0)).toEqual([]);
    expect(cashSuggestions(-5)).toEqual([]);
    expect(cashSuggestions(Number.NaN)).toEqual([]);
  });

  it('keeps the list short enough to be a row of buttons', () => {
    for (const total of [1, 240.1, 1234.56, 9999]) {
      expect(cashSuggestions(total).length).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// The invariant that matters most
// ---------------------------------------------------------------------------

describe('presentation agrees with what actually gets stored', () => {
  // presentLine() computes a line total for the SCREEN; computeLineMoney()
  // computes the one written to SQLite. Two implementations of the same
  // figure is exactly how a cart starts showing a number the bill does not
  // charge, so they are checked against each other directly.
  it('shows the same line total the checkout stores', async () => {
    const { computeLineMoney } = await import('../local-checkout');

    const cases = [
      { unit_price: '343.00', quantity: 1, discount_pct: 30, tax_rate: '5' },
      { unit_price: '343.00', quantity: 3, discount_pct: 30, tax_rate: '5' },
      { unit_price: '129.99', quantity: 2.5, discount_pct: 12.5, tax_rate: '5' },
      { unit_price: '86753.09', quantity: 1, discount_pct: 0, tax_rate: '18' },
      { unit_price: '700.07', quantity: 3, discount_pct: 12.5, tax_rate: '12' },
      { unit_price: '0.05', quantity: 7, discount_pct: 0, tax_rate: '5' },
      { unit_price: '1000.00', quantity: 1, discount_pct: 100, tax_rate: '5' },
    ];

    for (const c of cases) {
      const shown = presentLine({
        unit_price: c.unit_price,
        quantity: c.quantity,
        discount_pct: c.discount_pct,
        mrp: null,
      });
      const stored = computeLineMoney({
        variant_id: 'v',
        sku: 's',
        product_name: 'p',
        variant_name: '',
        unit_price: c.unit_price,
        tax_rate: c.tax_rate,
        quantity: c.quantity,
        discount_pct: c.discount_pct,
      });

      // Integer paise on both sides — no float comparison.
      expect(Math.round(shown.lineTotal * 100)).toBe(stored.lineTotalPaise);
    }
  });

  it('shows the same discount amount the checkout stores', async () => {
    const { computeLineMoney } = await import('../local-checkout');

    const shown = presentLine({
      unit_price: '343.00', quantity: 1, discount_pct: 30, mrp: '343.00',
    });
    const stored = computeLineMoney({
      variant_id: 'v', sku: 's', product_name: 'p', variant_name: '',
      unit_price: '343.00', tax_rate: '5', quantity: 1, discount_pct: 30,
    });

    expect(Math.round(shown.discountAmount * 100)).toBe(stored.discountPaise);
  });
});
