/**
 * Code 128 encoding.
 *
 * A barcode that scans as the WRONG SKU is far worse than one that does not
 * print — it silently sells the wrong item at the wrong price and corrupts
 * stock for both. So the checksum and the symbol table are pinned against
 * known-good values rather than trusted.
 */

import { describe, expect, it } from 'vitest';

import { code128Svg, code128Widths, isEncodable } from '@/lib/barcode';

describe('isEncodable', () => {
  it('accepts the SKUs this catalogue actually holds', () => {
    expect(isEncodable('300100')).toBe(true);
    expect(isEncodable('KUR-NV-L')).toBe(true);
    expect(isEncodable('MS1/300100')).toBe(true);
  });

  it('refuses an empty value', () => {
    expect(isEncodable('')).toBe(false);
  });

  it('refuses characters subset B cannot carry', () => {
    expect(isEncodable('300\n100')).toBe(false);
    expect(isEncodable('साड़ी')).toBe(false);
  });
});

describe('code128Widths', () => {
  it('starts with the subset B start symbol', () => {
    // Start B is symbol 104, pattern "211214". (103 is Start A, 105 Start C —
    // an easy off-by-one, and the reason this is pinned.)
    expect(code128Widths('A').slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
  });

  it('ends with the stop symbol', () => {
    // Stop is "2331112" — seven elements, the only pattern that is not six.
    expect(code128Widths('A').slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('computes the modulo-103 checksum correctly', () => {
    // "A" is symbol 33. checksum = (104 + 33*1) % 103 = 34 -> pattern "131123".
    const widths = code128Widths('A');
    const checksumPattern = widths.slice(-13, -7);
    expect(checksumPattern).toEqual([1, 3, 1, 1, 2, 3]);
  });

  it('encodes a real SKU to the expected symbol count', () => {
    // start + 6 data + checksum = 8 six-element patterns, plus a 7-element stop.
    expect(code128Widths('300100')).toHaveLength(8 * 6 + 7);
  });

  it('is deterministic', () => {
    expect(code128Widths('300100')).toEqual(code128Widths('300100'));
  });

  it('gives different SKUs different symbols', () => {
    expect(code128Widths('300100')).not.toEqual(code128Widths('300101'));
  });

  it('throws rather than dropping an unencodable character', () => {
    expect(() => code128Widths('साड़ी')).toThrow(/Cannot encode/);
    expect(() => code128Widths('')).toThrow();
  });
});

describe('code128Svg', () => {
  it('produces vector bars, not a bitmap', () => {
    const svg = code128Svg('300100');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('data:image');
  });

  it('prints the value underneath so a human can read it', () => {
    expect(code128Svg('300100')).toContain('>300100<');
  });

  it('can omit the text for a very small tag', () => {
    expect(code128Svg('300100', { showText: false })).not.toContain('<text');
  });

  it('scales width with the module size', () => {
    const narrow = code128Svg('300100', { moduleWidth: 1 });
    const wide = code128Svg('300100', { moduleWidth: 3 });
    const widthOf = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(widthOf(wide)).toBe(widthOf(narrow) * 3);
  });

  it('escapes a value that would otherwise break the SVG', () => {
    const svg = code128Svg('A&B');
    expect(svg).toContain('A&amp;B');
    expect(svg).not.toContain('>A&B<');
  });
});
