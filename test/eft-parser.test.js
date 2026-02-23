import { describe, it, expect } from 'vitest';
import { parseEft, formatDate, titleCase } from '../src/eft-parser.js';
import { EftParseError } from '../src/errors.js';
import { eftBuf } from './fixture.js';

const eft = parseEft(eftBuf);

describe('parseEft', () => {
  it('parses type1 fields', () => {
    expect(typeof eft.type1).toBe('object');
    expect(eft.type1['1.01']).toBe('131');
    expect(eft.type1['1.02']).toBe('0502');
    expect(eft.type1['1.03']).toBeTruthy();
  });

  it('parses type2 demographics', () => {
    expect(eft.type2.fullName).toBe('Michael Scott');
    expect(eft.type2.name.first).toBe('Michael');
    expect(eft.type2.name.last).toBe('Scott');
    expect(eft.type2.sex).toBe('M');
    expect(eft.type2.dob).toStrictEqual({ year: 1962, month: 3, day: 15 });
    expect(eft.type2.eyeColor).toBe('BRO');
    expect(eft.type2.hairColor).toBe('BRO');
    expect(eft.type2.weight).toBe(185);
    expect(eft.type2.height).toBe('511');
    expect(eft.type2.address).toBe('1725 SLOUGH AVE, SCRANTON, PA 18505');
    expect(eft.type2.purpose).toBe('CRIMINAL');
    expect(eft.type2.scanner).toStrictEqual({ make: 'TESTSCAN', model: 'MODEL1', serial: 'SN001' });
  });

  it('parses 1 type4 record', () => {
    expect(eft.type4Records.length).toBe(1);
  });

  it('reports correct fileSize', () => {
    expect(eft.fileSize).toBe(eftBuf.length);
  });

  it('parses type4 record fields correctly', () => {
    const rec = eft.type4Records[0];
    expect(rec.fingerPosition).toBe(6);
    expect(rec.fingerName).toBe('Left Thumb');
    expect(rec.width).toBe(545);
    expect(rec.height).toBe(622);
    expect(rec.compressionName).toBe('WSQ');
    expect(rec.impressionName).toBe('Live-scan rolled');
    expect(rec.ppi).toBe(500);
    expect(rec.imageData instanceof Uint8Array || Buffer.isBuffer(rec.imageData)).toBeTruthy();
    expect(rec.imageData.length > 0).toBeTruthy();
  });
});

describe('parseEft — negative', () => {
  it('throws EftParseError on empty buffer', () => {
    expect(() => parseEft(Buffer.alloc(0))).toThrow(EftParseError);
    expect(() => parseEft(Buffer.alloc(0))).toThrow(/FS terminator/);
  });

  it('throws EftParseError on non-EFT data', () => {
    expect(() => parseEft(Buffer.from('not an eft file'))).toThrow(EftParseError);
    expect(() => parseEft(Buffer.from('not an eft file'))).toThrow(/FS terminator/);
  });
});

describe('formatDate', () => {
  it('formats a date object', () => {
    expect(formatDate({ year: 1990, month: 11, day: 2 })).toBe('November 2, 1990');
  });

  it('returns "Unknown" for null', () => {
    expect(formatDate(null)).toBe('Unknown');
  });

  it('returns "Unknown" for undefined', () => {
    expect(formatDate(undefined)).toBe('Unknown');
  });

  it('handles invalid month gracefully', () => {
    expect(formatDate({ year: 2000, month: 0, day: 1 })).toBe('Unknown 1, 2000');
    expect(formatDate({ year: 2000, month: 13, day: 1 })).toBe('Unknown 1, 2000');
  });
});

describe('titleCase', () => {
  it('converts lowercase', () => {
    expect(titleCase('hello world')).toBe('Hello World');
  });

  it('converts UPPERCASE', () => {
    expect(titleCase('HELLO WORLD')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(titleCase('')).toBe('');
  });
});
