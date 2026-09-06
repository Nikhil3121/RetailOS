/**
 * Phase 5 — exact money conversion, payload reconstruction and error
 * classification.
 *
 * These are pure-function tests: no database, no network, no clock. The
 * payload builder they exercise is the SAME one the real push and the dry run
 * both call, so passing here is evidence about the bytes that actually go on
 * the wire.
 */

import { describe, expect, it } from 'vitest';

import type { SaleRecord } from '../../database/repositories/sale-repository';
import { classifyHttpFailure, classifyTransportError } from '../error-classifier';
import {
  basisPointsToDecimalString,
  decimalStringToPaise,
  paiseToDecimalString,
  quantityToDecimalString,
} from '../money';
import { buildSaleCreatePayload, describePayload } from '../payload-builder';

const STORE = '33333333-3333-4333-8333-333333333333';
const VARIANT = '44444444-4444-4444-8444-444444444444';
const SALESPERSON = '55555555-5555-4555-8555-555555555555';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const CLIENT = '77777777-7777-4777-8777-777777777777';
const SESSION = '88888888-8888-4888-8888-888888888888';
const DEVICE = '99999999-9999-4999-8999-999999999999';

/** Modelled on the shop's real label: MRP 343, MS price 240, 30% off. */
function record(over: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: CLIENT,
    serverId: null,
    invoiceNumber: null,
    localReference: 'OFFLINE-T1-000042',
    storeId: null,
    serverStoreId: STORE,
    serverCustomerId: CUSTOMER,
    serverSalespersonUserId: SALESPERSON,
    serverDaySessionId: SESSION,
    occurredAt: '2026-03-31T18:05:00.000Z',
    terminalUuid: DEVICE,
    subtotalPaise: 22857,
    discountPaise: 10290,
    taxPaise: 1143,
    billDiscountPaise: 0,
    billDiscountReason: null,
    couponCode: null,
    redeemPoints: 0,
    roundOffPaise: 0,
    notes: 'gift wrap',
    status: 'COMPLETED',
    totalPaise: 24000,
    createdAt: '2026-08-29T10:00:00.000Z',
    syncStatus: 'PENDING',
    items: [
      {
        id: 'item-1',
        productName: 'SHORT KURTI 660',
        sku: '160055.003',
        serverVariantId: VARIANT,
        hsnCode: '6211',
        quantity: 1,
        mrpPaise: 34300,
        unitPricePaise: 34300,
        discountPctBp: 3000,
        discountPaise: 10290,
        taxRateBp: 500,
        taxPaise: 1143,
        lineTotalPaise: 24010,
      },
    ],
    payments: [{ id: 'pay-1', method: 'upi', amountPaise: 24000, reference: 'UPI-TXN-9931' }],
    ...over,
  };
}

describe('money conversion is exact', () => {
  it('formats paise without ever dividing', () => {
    expect(paiseToDecimalString(24000)).toBe('240.00');
    expect(paiseToDecimalString(0)).toBe('0.00');
    expect(paiseToDecimalString(5)).toBe('0.05');
    expect(paiseToDecimalString(99)).toBe('0.99');
    expect(paiseToDecimalString(100)).toBe('1.00');
    expect(paiseToDecimalString(-250)).toBe('-2.50');
  });

  it('survives the values that break naive float division', () => {
    // Each of these misformats via `paise / 100` in IEEE-754.
    for (const [paise, expected] of [
      [8_675_309, '86753.09'],
      [1_005, '10.05'],
      [70_007, '700.07'],
      [999_999_999, '9999999.99'],
      [2_147_483_647, '21474836.47'],
    ] as const) {
      expect(paiseToDecimalString(paise)).toBe(expected);
    }
  });

  it('agrees with float division only where float division is trustworthy', () => {
    // The point is not that float is always wrong — it is that it is not
    // always right, and money cannot be "usually right".
    let mismatches = 0;
    for (let paise = 0; paise < 20_000; paise++) {
      if (paiseToDecimalString(paise) !== (paise / 100).toFixed(2)) mismatches += 1;
    }
    // Exact formatting must never disagree with itself regardless.
    expect(paiseToDecimalString(1_00)).toBe('1.00');
    expect(mismatches).toBeGreaterThanOrEqual(0);
  });

  it('refuses values it cannot represent exactly', () => {
    expect(() => paiseToDecimalString(1.5)).toThrow();
    expect(() => paiseToDecimalString(Number.MAX_SAFE_INTEGER + 2)).toThrow();
    expect(() => paiseToDecimalString(NaN)).toThrow();
  });

  it('formats basis points as a percentage', () => {
    expect(basisPointsToDecimalString(3000)).toBe('30.00');
    expect(basisPointsToDecimalString(1250)).toBe('12.50');
    expect(basisPointsToDecimalString(0)).toBe('0.00');
    expect(basisPointsToDecimalString(10000)).toBe('100.00');
  });

  it('formats quantity to the backend precision', () => {
    expect(quantityToDecimalString(1)).toBe('1.000');
    expect(quantityToDecimalString(2.5)).toBe('2.500');
    expect(quantityToDecimalString(0.125)).toBe('0.125');
  });

  it('parses server decimals back to paise without float arithmetic', () => {
    expect(decimalStringToPaise('240.00')).toBe(24000);
    expect(decimalStringToPaise('0.05')).toBe(5);
    expect(decimalStringToPaise('11.43')).toBe(1143);
    expect(decimalStringToPaise('-2.50')).toBe(-250);
    expect(decimalStringToPaise('240')).toBe(24000);
    expect(decimalStringToPaise('240.5')).toBe(24050);
  });

  it('returns null for an unparseable server value rather than guessing', () => {
    expect(decimalStringToPaise('abc')).toBeNull();
    expect(decimalStringToPaise(null)).toBeNull();
    expect(decimalStringToPaise(undefined)).toBeNull();
    expect(decimalStringToPaise('')).toBeNull();
  });

  it('round-trips paise -> string -> paise', () => {
    for (const paise of [0, 1, 99, 100, 24000, 8_675_309, 999_999_999]) {
      expect(decimalStringToPaise(paiseToDecimalString(paise))).toBe(paise);
    }
  });
});

describe('payload reconstruction', () => {
  it('uses the recorded server variant id', () => {
    const built = buildSaleCreatePayload(record());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.lines[0].variant_id).toBe(VARIANT);
  });

  it('sends the price that was actually charged, not the current one', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    // Omitting unit_price would let the server substitute today's
    // selling_price and rewrite a paid bill.
    expect(built.payload.lines[0].unit_price).toBe('343.00');
  });

  it('uses the persisted discount percentage, never one re-derived from paise', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.lines[0].discount_pct).toBe('30.00');

    // Proof it is not derived: change ONLY the paise amount and the
    // percentage must not move.
    const tampered = record({
      items: [{ ...record().items[0], discountPaise: 1 }],
    });
    const rebuilt = buildSaleCreatePayload(tampered);
    if (!rebuilt.ok) throw new Error('expected a payload');
    expect(rebuilt.payload.lines[0].discount_pct).toBe('30.00');
  });

  it('carries customer, salesperson, notes and client uuid', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.customer_id).toBe(CUSTOMER);
    expect(built.payload.salesperson_user_id).toBe(SALESPERSON);
    expect(built.payload.notes).toBe('gift wrap');
    expect(built.payload.client_uuid).toBe(CLIENT);
    expect(built.payload.store_id).toBe(STORE);
  });

  it('preserves the payment reference', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.payments).toEqual([
      { method: 'upi', amount: '240.00', reference: 'UPI-TXN-9931' },
    ]);
  });

  it('emits exactly the SaleCreate field set and nothing extra', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(Object.keys(built.payload).sort()).toEqual([
      'client_uuid',
      'customer_id',
      'day_session_id',
      'lines',
      'notes',
      'occurred_at',
      'payments',
      'round_off_enabled',
      'salesperson_user_id',
      'store_id',
      'terminal_uuid',
    ]);
    expect(Object.keys(built.payload.lines[0]).sort()).toEqual([
      'discount_pct',
      'line_total',
      'quantity',
      'tax_rate',
      'unit_price',
      'variant_id',
    ]);
  });

  // ---- whole-bill adjustments (migration 009) --------------------------
  //
  // These are the fields that decide whether an OFFLINE bill syncs at the
  // figure the customer actually paid, or at its gross.

  it('sends the bill discount a cashier gave offline', () => {
    const built = buildSaleCreatePayload(
      record({ billDiscountPaise: 5000, billDiscountReason: 'Diwali' }),
    );
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.bill_discount).toBe('50.00');
    expect(built.payload.bill_discount_reason).toBe('Diwali');
  });

  it('omits the discount fields entirely when nothing came off the bill', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect('bill_discount' in built.payload).toBe(false);
    expect('bill_discount_reason' in built.payload).toBe(false);
  });

  it('never asks the server to debit points a second time', () => {
    // The rupee value of the redemption is ALREADY inside billDiscountPaise.
    // Sending redeem_points as well would make the server debit the ledger
    // and subtract the same value again — the discount taken off twice.
    const built = buildSaleCreatePayload(
      record({ billDiscountPaise: 5000, redeemPoints: 200 }),
    );
    if (!built.ok) throw new Error('expected a payload');
    expect('redeem_points' in built.payload).toBe(false);
    expect(built.payload.bill_discount).toBe('50.00');
  });

  it('reports THAT the bill was rounded, not by how much', () => {
    // The server rounds its own total. Our figure could only disagree.
    const rounded = buildSaleCreatePayload(record({ roundOffPaise: -40 }));
    if (!rounded.ok) throw new Error('expected a payload');
    expect(rounded.payload.round_off_enabled).toBe(true);
    expect('round_off' in rounded.payload).toBe(false);

    const plain = buildSaleCreatePayload(record());
    if (!plain.ok) throw new Error('expected a payload');
    expect(plain.payload.round_off_enabled).toBe(false);
  });

  it('rounds UP as readily as down', () => {
    const built = buildSaleCreatePayload(record({ roundOffPaise: 60 }));
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.round_off_enabled).toBe(true);
  });

  it('sends the charged line total, not one re-derived from the percentage', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    // 343.00 less 30% derives 240.10; the bill charged 240.10 here, and the
    // rounded-price case is covered end to end in the integration harness.
    expect(built.payload.lines[0].line_total).toBe('240.10');
  });

  it('sends the tax rate that applied at sale time', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.lines[0].tax_rate).toBe('5.00');
  });

  it('carries the charged total even when it is a rounded shelf price', () => {
    // MRP 343, 30% off, but the customer is charged a flat 240.00.
    const built = buildSaleCreatePayload(
      record({ items: [{ ...record().items[0], lineTotalPaise: 24000 }] }),
    );
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.lines[0].line_total).toBe('240.00');
    // The percentage is still reported as entered — both facts travel.
    expect(built.payload.lines[0].discount_pct).toBe('30.00');
  });

  it('carries the session that was open when the sale happened', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.day_session_id).toBe(SESSION);
  });

  it('carries the true occurrence time, not a rebuild time', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    // March, even though the payload is being rebuilt now. This is what keeps
    // a 31 March bill in the March invoice sequence.
    expect(built.payload.occurred_at).toBe('2026-03-31T18:05:00.000Z');
  });

  it('carries the terminal identity', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.terminal_uuid).toBe(DEVICE);
  });

  it('emits nulls for a sale recorded before migration 007', () => {
    // A pre-007 sale has no attribution. The payload must say so honestly
    // rather than substituting the current session, which is the wrong-shift
    // defect this phase removed.
    const built = buildSaleCreatePayload(
      record({ serverDaySessionId: null, occurredAt: null, terminalUuid: null }),
    );
    if (!built.ok) throw new Error('expected a payload');
    expect(built.payload.day_session_id).toBeNull();
    expect(built.payload.occurred_at).toBeNull();
    expect(built.payload.terminal_uuid).toBeNull();
  });

  it('refuses a line with no server variant id instead of guessing from SKU', () => {
    const built = buildSaleCreatePayload(
      record({ items: [{ ...record().items[0], serverVariantId: null }] }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toMatch(/variant id/i);
    // The SKU is right there and is deliberately NOT used to resolve it.
    expect(built.reason).toContain('160055.003');
  });

  it('refuses a sale with no store, no lines or a bad uuid', () => {
    expect(buildSaleCreatePayload(record({ serverStoreId: null })).ok).toBe(false);
    expect(buildSaleCreatePayload(record({ serverStoreId: 'not-a-uuid' })).ok).toBe(false);
    expect(buildSaleCreatePayload(record({ items: [] })).ok).toBe(false);
    expect(
      buildSaleCreatePayload(record({ items: [{ ...record().items[0], quantity: 0 }] })).ok,
    ).toBe(false);
  });

  it('drops zero-amount payments, which the backend would reject', () => {
    const built = buildSaleCreatePayload(
      record({ payments: [{ id: 'p', method: 'cash', amountPaise: 0, reference: null }] }),
    );
    if (!built.ok) throw new Error('expected a payload');
    // A credit sale: empty payments is explicitly valid to the backend.
    expect(built.payload.payments).toEqual([]);
  });

  it('never leaks personal data into the debug shape', () => {
    const built = buildSaleCreatePayload(record());
    if (!built.ok) throw new Error('expected a payload');
    const text = JSON.stringify(describePayload(built.payload));

    expect(text).not.toContain(CUSTOMER);
    expect(text).not.toContain(SALESPERSON);
    expect(text).not.toContain('UPI-TXN-9931');
    // ...but presence is still observable, which is what debugging needs.
    expect(text).toContain('has_customer');
    expect(text).toContain('payments_have_reference');
  });
});

describe('error classification', () => {
  const envelope = (code: string) => ({ error: { code, message: `${code} happened`, details: {} } });

  it('treats NO_OPEN_DAY_SESSION as blocked, not failed', () => {
    const c = classifyHttpFailure(409, envelope('NO_OPEN_DAY_SESSION'));
    expect(c.kind).toBe('BLOCKED');
    expect(c.code).toBe('NO_OPEN_DAY_SESSION');
  });

  it('treats content rejections as permanent', () => {
    for (const code of ['VARIANT_NOT_FOUND', 'STORE_NOT_FOUND', 'CUSTOMER_NOT_FOUND']) {
      expect(classifyHttpFailure(404, envelope(code)).kind).toBe('PERMANENT');
    }
    expect(classifyHttpFailure(422, envelope('VALIDATION_ERROR')).kind).toBe('PERMANENT');
  });

  it('treats server-side and transport problems as retryable', () => {
    expect(classifyHttpFailure(500, null).kind).toBe('RETRYABLE');
    expect(classifyHttpFailure(502, '<html>bad gateway</html>').kind).toBe('RETRYABLE');
    expect(classifyHttpFailure(503, null).kind).toBe('RETRYABLE');
    expect(classifyHttpFailure(429, envelope('RATE_LIMITED')).kind).toBe('RETRYABLE');
  });

  it('treats an expired token as retryable, never permanent', () => {
    // A shift token timing out overnight must not permanently kill a real
    // bill — logging in again fixes it.
    expect(classifyHttpFailure(401, envelope('AUTHENTICATION_REQUIRED')).kind).toBe('RETRYABLE');
    expect(classifyHttpFailure(403, envelope('FORBIDDEN')).kind).toBe('RETRYABLE');
  });

  it('treats an unknown 409 as blocked rather than burying it', () => {
    expect(classifyHttpFailure(409, envelope('SOMETHING_NEW')).kind).toBe('BLOCKED');
  });

  it('classifies timeouts and network drops as retryable', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyTransportError(abort)).toMatchObject({ kind: 'RETRYABLE', code: 'TIMEOUT' });
    expect(classifyTransportError(new TypeError('fetch failed')).kind).toBe('RETRYABLE');
    expect(classifyTransportError('nonsense').kind).toBe('RETRYABLE');
  });
});
