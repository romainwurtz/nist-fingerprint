import { describe, it, expect } from 'vitest';
import { resolveFingerPosition, filterRecords, formatHeight } from '../src/helpers.js';
import { ValidationError } from '../src/errors.js';

describe('resolveFingerPosition', () => {
  it('returns null for null input', () => {
    expect(resolveFingerPosition(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(resolveFingerPosition(undefined)).toBeNull();
  });

  it('resolves numeric string to position', () => {
    expect(resolveFingerPosition('1')).toBe(1);
    expect(resolveFingerPosition('10')).toBe(10);
    expect(resolveFingerPosition('14')).toBe(14);
  });

  it('resolves alias to position', () => {
    expect(resolveFingerPosition('right_thumb')).toBe(1);
    expect(resolveFingerPosition('left_index')).toBe(7);
    expect(resolveFingerPosition('plain_right_four')).toBe(13);
  });

  it('resolves alias with hyphens and spaces', () => {
    expect(resolveFingerPosition('right-thumb')).toBe(1);
    expect(resolveFingerPosition('left index')).toBe(7);
  });

  it('is case-insensitive', () => {
    expect(resolveFingerPosition('RIGHT_THUMB')).toBe(1);
    expect(resolveFingerPosition('Left_Index')).toBe(7);
  });

  it('throws ValidationError on unknown finger', () => {
    expect(() => resolveFingerPosition('pinky')).toThrow(ValidationError);
    expect(() => resolveFingerPosition('pinky')).toThrow(/Unknown finger/);
  });

  it('throws ValidationError on position 0', () => {
    expect(() => resolveFingerPosition('0')).toThrow(ValidationError);
  });

  it('throws ValidationError on out-of-range number', () => {
    expect(() => resolveFingerPosition('99')).toThrow(ValidationError);
  });
});

describe('filterRecords', () => {
  const records = [
    { fingerPosition: 1, fingerName: 'Right Thumb' },
    { fingerPosition: 2, fingerName: 'Right Index' },
    { fingerPosition: 6, fingerName: 'Left Thumb' },
  ];

  it('returns all records when no filter', () => {
    expect(filterRecords(records, null).length).toBe(3);
    expect(filterRecords(records, undefined).length).toBe(3);
  });

  it('filters by position string', () => {
    const result = filterRecords(records, '1');
    expect(result.length).toBe(1);
    expect(result[0].fingerPosition).toBe(1);
  });

  it('filters by name alias', () => {
    const result = filterRecords(records, 'left_thumb');
    expect(result.length).toBe(1);
    expect(result[0].fingerPosition).toBe(6);
  });

  it('throws ValidationError when no record matches', () => {
    expect(() => filterRecords(records, '10')).toThrow(ValidationError);
    expect(() => filterRecords(records, '10')).toThrow(/No fingerprint record found/);
  });
});

describe('formatHeight', () => {
  it('formats "602" as 6\'02"', () => {
    expect(formatHeight('602')).toBe('6\'02"');
  });

  it('formats "511" as 5\'11"', () => {
    expect(formatHeight('511')).toBe('5\'11"');
  });

  it('returns short strings as-is', () => {
    expect(formatHeight('5')).toBe('5');
    expect(formatHeight('')).toBe('');
  });

  it('returns non-numeric strings as-is', () => {
    expect(formatHeight('abc')).toBe('abc');
    expect(formatHeight('9XX')).toBe('9XX');
  });

  it('returns null/undefined as-is', () => {
    expect(formatHeight(null)).toBeNull();
    expect(formatHeight(undefined)).toBe(undefined);
  });
});
