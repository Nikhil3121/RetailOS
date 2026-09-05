/**
 * Money on the screen.
 *
 * The bug these exist to prevent is the one the dashboard actually shipped
 * with: `₹180.00000`, because a server `Numeric` came back as a string with
 * five decimal places and went straight into JSX.
 */

import { describe, expect, it } from 'vitest';

import { formatMoney, formatPercent, groupIndian, sumDecimals } from '@/lib/money';

describe('formatMoney', () => {
  it('trims a server decimal to two places', () => {
    expect(formatMoney('180.00000')).toBe('₹180.00');
    expect(formatMoney('1234.5')).toBe('₹1,234.50');
    expect(formatMoney('99')).toBe('₹99.00');
  });

  it('groups the Indian way, not in threes', () => {
    expect(formatMoney('1234567.89')).toBe('₹12,34,567.89');
    expect(formatMoney('100000')).toBe('₹1,00,000.00');
    expect(formatMoney('10000000')).toBe('₹1,00,00,000.00');
  });

  it('rounds half up and carries into the rupees', () => {
    expect(formatMoney('10.005')).toBe('₹10.01');
    expect(formatMoney('10.004')).toBe('₹10.00');
    // The fraction wraps, so the rupee count must go up.
    expect(formatMoney('9.999')).toBe('₹10.00');
    expect(formatMoney('99999.999')).toBe('₹1,00,000.00');
  });

  it('does not lose precision on figures a float would mangle', () => {
    // 21 significant digits — beyond a double, and exact here because nothing
    // in this module ever calls Number().
    expect(formatMoney('123456789012345678.99')).toBe('₹1,23,45,67,89,01,23,45,678.99');
  });

  it('keeps a real negative but never prints minus zero', () => {
    expect(formatMoney('-450.50')).toBe('-₹450.50');
    expect(formatMoney('-0.001')).toBe('₹0.00');
  });

  it('falls back rather than throwing on missing or malformed input', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney('')).toBe('—');
    expect(formatMoney('not a number')).toBe('—');
    expect(formatMoney('12.3.4')).toBe('—');
  });

  it('can drop the symbol and the decimals', () => {
    expect(formatMoney('1234.56', { symbol: false })).toBe('1,234.56');
    expect(formatMoney('1234.56', { decimals: 0 })).toBe('₹1,235');
  });
});

describe('sumDecimals', () => {
  it('adds exactly where a float would drift', () => {
    // 0.1 + 0.2 is the canonical float failure. Here it is just 0.30.
    expect(formatMoney(sumDecimals(['0.10', '0.20']))).toBe('₹0.30');
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3000');
  });

  it('totals a payment mix to the sum of its parts', () => {
    const mix = ['1234.55', '890.45', '2000.00', '0.00'];
    expect(formatMoney(sumDecimals(mix))).toBe('₹4,125.00');
  });

  it('skips missing channels rather than poisoning the total', () => {
    expect(formatMoney(sumDecimals(['100.00', null, undefined, '', '50.50']))).toBe('₹150.50');
  });

  it('handles refunds, which arrive negative', () => {
    expect(formatMoney(sumDecimals(['500.00', '-120.25']))).toBe('₹379.75');
  });

  it('is exact on figures past a float’s precision', () => {
    expect(sumDecimals(['9007199254740993.01', '0.01'])).toBe('9007199254740993.0200');
  });
});

describe('groupIndian', () => {
  it('leaves short numbers alone', () => {
    expect(groupIndian('5')).toBe('5');
    expect(groupIndian('999')).toBe('999');
  });

  it('takes the last three, then pairs', () => {
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('123456')).toBe('1,23,456');
  });
});

describe('formatPercent', () => {
  it('trims to one place by default', () => {
    expect(formatPercent('18.5000')).toBe('18.5%');
    expect(formatPercent('0')).toBe('0.0%');
  });

  it('handles a negative margin', () => {
    expect(formatPercent('-4.25')).toBe('-4.3%');
  });

  it('falls back on junk', () => {
    expect(formatPercent(null)).toBe('—');
  });
});
