/**
 * IPC validation tests.
 *
 * The point of these is the negative cases. A validator that accepts good
 * input is easy; what matters is that hostile or malformed input from the
 * renderer is rejected before it reaches a repository.
 */

import { describe, expect, it } from 'vitest';

import {
  IpcValidationError,
  optionalString,
  optionalUuid,
  requireArray,
  requireInt,
  requireNumber,
  requireObject,
  requireOneOf,
  requireString,
  requireUuid,
} from '../validation';

describe('requireString', () => {
  it('accepts and trims', () => {
    expect(requireString('  hello  ', 'f')).toBe('hello');
  });

  it('rejects non-strings, empties and over-length input', () => {
    expect(() => requireString(42, 'f')).toThrow(IpcValidationError);
    expect(() => requireString(null, 'f')).toThrow(IpcValidationError);
    expect(() => requireString('   ', 'f')).toThrow(/must not be empty/);
    expect(() => requireString('x'.repeat(300), 'f', 255)).toThrow(/exceeds/);
  });
});

describe('optionalString', () => {
  it('maps absent and blank to null', () => {
    expect(optionalString(undefined, 'f')).toBeNull();
    expect(optionalString(null, 'f')).toBeNull();
    expect(optionalString('  ', 'f')).toBeNull();
  });

  it('still rejects wrong types', () => {
    expect(() => optionalString(5, 'f')).toThrow(IpcValidationError);
  });
});

describe('requireInt', () => {
  it('accepts integers within range', () => {
    expect(requireInt(10, 'f', { min: 0, max: 100 })).toBe(10);
  });

  it('rejects fractions, NaN, Infinity and out-of-range', () => {
    expect(() => requireInt(1.5, 'f')).toThrow(/integer/);
    expect(() => requireInt(NaN, 'f')).toThrow(/integer/);
    expect(() => requireInt(Infinity, 'f')).toThrow(/integer/);
    expect(() => requireInt(-1, 'f', { min: 0 })).toThrow(/between/);
    expect(() => requireInt('5', 'f')).toThrow(/integer/);
  });
});

describe('requireNumber', () => {
  it('accepts fractional quantity', () => {
    expect(requireNumber(2.5, 'qty', { min: 0.001 })).toBe(2.5);
  });

  it('rejects zero and negative when a floor is set', () => {
    expect(() => requireNumber(0, 'qty', { min: 0.001 })).toThrow(/between/);
    expect(() => requireNumber(-3, 'qty', { min: 0.001 })).toThrow(/between/);
  });
});

describe('requireUuid', () => {
  it('accepts a v4 UUID', () => {
    expect(requireUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'id')).toBeTruthy();
  });

  it('rejects near-misses and injection attempts', () => {
    expect(() => requireUuid('not-a-uuid', 'id')).toThrow(/UUID/);
    expect(() => requireUuid("'; DROP TABLE sale; --", 'id')).toThrow(/UUID/);
    expect(() => requireUuid('3f2504e0-4f89-41d3-9a0c', 'id')).toThrow(/UUID/);
  });

  it('optionalUuid allows absence but not garbage', () => {
    expect(optionalUuid(undefined, 'id')).toBeNull();
    expect(() => optionalUuid('abc', 'id')).toThrow(/UUID/);
  });
});

describe('requireOneOf', () => {
  it('accepts a listed value and rejects anything else', () => {
    const methods = ['cash', 'card', 'upi'] as const;
    expect(requireOneOf('cash', 'method', methods)).toBe('cash');
    expect(() => requireOneOf('bitcoin', 'method', methods)).toThrow(/must be one of/);
  });
});

describe('requireArray', () => {
  it('validates each item', () => {
    const out = requireArray([1, 2, 3], 'nums', (v, i) => requireInt(v, `nums[${i}]`));
    expect(out).toEqual([1, 2, 3]);
  });

  it('enforces min and max length', () => {
    expect(() => requireArray([], 'items', (v) => v, { min: 1 })).toThrow(/at least/);
    expect(() =>
      requireArray(Array(600).fill(1), 'items', (v) => v, { max: 500 }),
    ).toThrow(/at most/);
  });

  it('rejects non-arrays', () => {
    expect(() => requireArray('nope', 'items', (v) => v)).toThrow(/must be an array/);
  });

  it('surfaces the failing index', () => {
    expect(() =>
      requireArray([1, 'bad'], 'nums', (v, i) => requireInt(v, `nums[${i}]`)),
    ).toThrow(/nums\[1\]/);
  });
});

describe('requireObject', () => {
  it('rejects arrays and null, which typeof reports as object', () => {
    expect(() => requireObject([], 'o')).toThrow(/must be an object/);
    expect(() => requireObject(null, 'o')).toThrow(/must be an object/);
    expect(requireObject({ a: 1 }, 'o')).toEqual({ a: 1 });
  });
});
