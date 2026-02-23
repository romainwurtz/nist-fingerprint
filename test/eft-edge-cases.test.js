import { describe, it, expect } from 'vitest';
import { parseEft } from '../src/eft-parser.js';
import { EftParseError } from '../src/errors.js';
import { FS, GS, RS, US } from '../src/constants.js';
import { eftBuf } from './fixture.js';

/**
 * Build a minimal valid Type-1 + Type-2 EFT buffer.
 * CNT field claims the given record types.
 */
function buildMinimalEft(recordTypes) {
  // Type-1: fields 1.01 (length), 1.02 (version), 1.03 (CNT)
  // CNT: first subfield = "1 US <total>" then "type US idc" for each
  const total = recordTypes.length + 1; // +1 for Type-1 itself
  let cntValue = `1${String.fromCharCode(US)}${total}`;
  recordTypes.forEach((t, i) => {
    cntValue += `${String.fromCharCode(RS)}${t}${String.fromCharCode(US)}${i}`;
  });

  // Build Type-1 ASCII record
  const type1Body = `1.02:0502${String.fromCharCode(GS)}1.03:${cntValue}`;
  // Length = "1.01:" + length_digits + GS + body + FS
  // We'll compute iteratively
  let lenStr;
  for (let guess = 100; guess < 999; guess++) {
    const candidate = `1.01:${guess}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    if (candidate.length === guess) {
      lenStr = candidate;
      break;
    }
  }
  if (!lenStr) {
    // fallback: just use actual length
    const base = `1.01:${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    const actualLen = base.length + String(base.length + 3).length;
    lenStr = `1.01:${actualLen}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
  }

  // Type-2: minimal
  const type2Body = `2.01:10${String.fromCharCode(FS)}`;

  return Buffer.from(lenStr + type2Body, 'ascii');
}

/**
 * Build a minimal EFT buffer with a custom CNT value.
 * Constructs Type-1 with only 1.01, 1.02, and 1.03 fields, plus a Type-2.
 */
function buildEftWithCnt(cntValue) {
  const type1Body = `1.02:0502${String.fromCharCode(GS)}1.03:${cntValue}`;
  let lenStr;
  for (let guess = 100; guess < 999; guess++) {
    const candidate = `1.01:${guess}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    if (candidate.length === guess) {
      lenStr = candidate;
      break;
    }
  }
  if (!lenStr) {
    const base = `1.01:${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    const actualLen = base.length + String(base.length + 3).length;
    lenStr = `1.01:${actualLen}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
  }

  const type2Body = `2.01:10${String.fromCharCode(FS)}`;
  return Buffer.from(lenStr + type2Body, 'ascii');
}

/**
 * Build a minimal EFT buffer with custom Type-2 fields.
 * Each key in `fieldsObj` should be a full field tag (e.g. "2.018").
 */
function buildEftWithType2Fields(fieldsObj) {
  // Build Type-2 body from provided fields
  const entries = Object.entries(fieldsObj).map(([k, v]) => `${k}:${v}`);
  const type2Body = entries.join(String.fromCharCode(GS)) + String.fromCharCode(FS);

  // Build Type-1: 1.01, 1.02, 1.03 (CNT: 1 US 2 RS 2 US 0)
  const cntValue = `1${String.fromCharCode(US)}2${String.fromCharCode(RS)}2${String.fromCharCode(US)}0`;
  const type1Body = `1.02:0502${String.fromCharCode(GS)}1.03:${cntValue}`;

  let lenStr;
  for (let guess = 100; guess < 999; guess++) {
    const candidate = `1.01:${guess}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    if (candidate.length === guess) {
      lenStr = candidate;
      break;
    }
  }
  if (!lenStr) {
    const base = `1.01:${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    const actualLen = base.length + String(base.length + 3).length;
    lenStr = `1.01:${actualLen}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
  }

  return Buffer.from(lenStr + type2Body, 'ascii');
}

/**
 * Build a minimal Type-4 binary record.
 * @param {number} idc - IDC value
 * @param {object} [opts] - Override header fields
 */
function buildType4Record(idc, opts = {}) {
  const {
    len = 18 + 4, // header + 4 bytes of dummy image data
    imp = 0,
    fgp = 1,
    isr = 0,
    hll = 10,
    vll = 10,
    cga = 1,
    imageSize = 4,
  } = opts;
  const buf = Buffer.alloc(18 + imageSize);
  buf.writeUInt32BE(len, 0);
  buf[4] = idc;
  buf[5] = imp;
  buf[6] = fgp;
  buf[12] = isr;
  buf.writeUInt16BE(hll, 13);
  buf.writeUInt16BE(vll, 15);
  buf[17] = cga;
  return buf;
}

/**
 * Build EFT with Type-1 + Type-2 + Type-4.
 * CNT declares one Type-4 with given IDC.
 */
function buildEftWithType4(type4Buf, type4Idc = 0) {
  const cntValue = `1${String.fromCharCode(US)}3${String.fromCharCode(RS)}2${String.fromCharCode(US)}0${String.fromCharCode(RS)}4${String.fromCharCode(US)}${type4Idc}`;
  const type1Body = `1.02:0502${String.fromCharCode(GS)}1.03:${cntValue}`;

  let lenStr;
  for (let guess = 100; guess < 999; guess++) {
    const candidate = `1.01:${guess}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    if (candidate.length === guess) {
      lenStr = candidate;
      break;
    }
  }
  if (!lenStr) {
    const base = `1.01:${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
    const actualLen = base.length + String(base.length + 3).length;
    lenStr = `1.01:${actualLen}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
  }

  const type2Body = `2.01:7${String.fromCharCode(FS)}`;
  return Buffer.concat([Buffer.from(lenStr + type2Body, 'ascii'), type4Buf]);
}

describe('EFT parser edge cases', () => {
  it('throws EftParseError for unsupported record type (Type-7)', () => {
    const buf = buildMinimalEft([2, 7]);
    expect.assertions(3);
    try {
      parseEft(buf);
    } catch (err) {
      expect(err).toBeInstanceOf(EftParseError);
      expect(err.message).toMatch(/Unsupported/);
      expect(err.recordType).toBe(7);
    }
  });

  it('throws EftParseError on random bytes (no FS terminator)', () => {
    const randomBuf = Buffer.from(Array.from({ length: 64 }, () => Math.floor(Math.random() * 128 + 32)));
    // Ensure no FS byte exists
    for (let i = 0; i < randomBuf.length; i++) {
      if (randomBuf[i] === FS) randomBuf[i] = 0x20;
    }
    expect(() => parseEft(randomBuf)).toThrow(EftParseError);
    expect(() => parseEft(randomBuf)).toThrow(/FS terminator/);
  });

  it('type2.raw is a plain object with string values', () => {
    const eft = parseEft(eftBuf);
    expect(typeof eft.type2.raw).toBe('object');
    expect(Array.isArray(eft.type2.raw)).toBe(false);
    for (const value of Object.values(eft.type2.raw)) {
      expect(typeof value).toBe('string');
    }
  });

  it('type4 imageData is a Uint8Array', () => {
    const eft = parseEft(eftBuf);
    for (const rec of eft.type4Records) {
      expect(rec.imageData).toBeInstanceOf(Uint8Array);
    }
  });

  it('throws EftParseError when Type-4 data exceeds buffer', () => {
    const buf = buildMinimalEft([4]);
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/exceeds buffer/);
  });

  it('throws EftParseError on malformed CNT subfield', () => {
    // CNT with subfield missing US separator: "1<US>2<RS>abc" instead of "1<US>2<RS>4<US>0"
    const cntValue = `1${String.fromCharCode(US)}2${String.fromCharCode(RS)}abc`;
    const buf = buildEftWithCnt(cntValue);
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/Malformed CNT/);
  });

  it('throws EftParseError when CNT field is missing', () => {
    // Build Type-1 with no 1.03 field
    const type1Body = `1.02:0502`;
    let lenStr;
    for (let guess = 10; guess < 999; guess++) {
      const candidate = `1.01:${guess}${String.fromCharCode(GS)}${type1Body}${String.fromCharCode(FS)}`;
      if (candidate.length === guess) {
        lenStr = candidate;
        break;
      }
    }
    const type2Body = `2.01:10${String.fromCharCode(FS)}`;
    const buf = Buffer.from(lenStr + type2Body, 'ascii');
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/Missing CNT/);
  });

  it('type1 contains expected standard fields', () => {
    const eft = parseEft(eftBuf);
    expect(eft.type1).toHaveProperty('1.01');
    expect(eft.type1).toHaveProperty('1.02');
    expect(eft.type1).toHaveProperty('1.03');
  });
});

describe('Type-2 demographic parsing branches', () => {
  it('returns null name when 2.018 is absent', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10' });
    const eft = parseEft(buf);
    expect(eft.type2.name).toBeNull();
    expect(eft.type2.fullName).toBeNull();
  });

  it('parses last-name-only (empty first/middle)', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.018': 'SMITH,' });
    const eft = parseEft(buf);
    expect(eft.type2.name.last).toBe('Smith');
    expect(eft.type2.name.first).toBe('');
    expect(eft.type2.name.middle).toBe('');
  });

  it('parses name without middle name', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.018': 'SMITH,JOHN' });
    const eft = parseEft(buf);
    expect(eft.type2.name.first).toBe('John');
    expect(eft.type2.name.middle).toBe('');
    expect(eft.type2.name.last).toBe('Smith');
  });

  it('returns null scanner when 2.067 is absent', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10' });
    const eft = parseEft(buf);
    expect(eft.type2.scanner).toBeNull();
  });

  it('returns null for all missing optional fields', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10' });
    const eft = parseEft(buf);
    expect(eft.type2.sex).toBeNull();
    expect(eft.type2.race).toBeNull();
    expect(eft.type2.weight).toBeNull();
    expect(eft.type2.eyeColor).toBeNull();
    expect(eft.type2.hairColor).toBeNull();
    expect(eft.type2.purpose).toBeNull();
    expect(eft.type2.dateCaptured).toBeNull();
    expect(eft.type2.address).toBeNull();
  });

  it('parses dateCaptured when 2.038 is present', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.038': '20230115' });
    const eft = parseEft(buf);
    expect(eft.type2.dateCaptured).toEqual({ year: 2023, month: 1, day: 15 });
  });

  it('parses name with empty last name (comma-first)', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.018': ',JOHN MICHAEL' });
    const eft = parseEft(buf);
    expect(eft.type2.name.last).toBe('');
    expect(eft.type2.name.first).toBe('John');
    expect(eft.type2.name.middle).toBe('Michael');
  });

  it('parses scanner with only make (missing model/serial)', () => {
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.067': 'ACME' });
    const eft = parseEft(buf);
    expect(eft.type2.scanner.make).toBe('ACME');
    expect(eft.type2.scanner.model).toBe('');
    expect(eft.type2.scanner.serial).toBe('');
  });

  it('parses scanner with empty make (US-prefixed value)', () => {
    // Value starts with US → split gives empty parts[0], triggering || fallback
    const val = `${String.fromCharCode(US)}Model X${String.fromCharCode(US)}SN123`;
    const buf = buildEftWithType2Fields({ '2.01': '10', '2.067': val });
    const eft = parseEft(buf);
    expect(eft.type2.scanner.make).toBe('');
    expect(eft.type2.scanner.model).toBe('Model X');
    expect(eft.type2.scanner.serial).toBe('SN123');
  });
});

describe('Type-4 error paths and branch gaps', () => {
  it('throws when Type-4 length < header size', () => {
    const type4 = buildType4Record(0, { len: 10, imageSize: 0 });
    const buf = buildEftWithType4(type4, 0);
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/smaller than header/);
  });

  it('throws when Type-4 length exceeds buffer', () => {
    const type4 = buildType4Record(0, { len: 99999 });
    const buf = buildEftWithType4(type4, 0);
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/exceeds buffer/);
  });

  it('throws on IDC mismatch', () => {
    const type4 = buildType4Record(99, { len: 22 });
    const buf = buildEftWithType4(type4, 0);
    expect(() => parseEft(buf)).toThrow(EftParseError);
    expect(() => parseEft(buf)).toThrow(/IDC mismatch/);
  });

  it('falls back to buffer length when 1.01 field is missing', () => {
    // Build Type-1 without 1.01 field (only 1.02 and 1.03)
    const cntValue = `1${String.fromCharCode(US)}2${String.fromCharCode(RS)}2${String.fromCharCode(US)}0`;
    const type1Body = `1.02:0502${String.fromCharCode(GS)}1.03:${cntValue}${String.fromCharCode(FS)}`;
    const type2Body = `2.01:10${String.fromCharCode(FS)}`;
    const buf = Buffer.from(type1Body + type2Body, 'ascii');
    const eft = parseEft(buf);
    expect(eft.type1).toHaveProperty('1.02');
    expect(eft.type1).toHaveProperty('1.03');
  });

  it('skips GS-separated segment without colon', () => {
    // Build Type-1 with a field that has no colon (no 1.01 → fallback length)
    const cntValue = `1${String.fromCharCode(US)}2${String.fromCharCode(RS)}2${String.fromCharCode(US)}0`;
    const type1Content = [
      'nocolon',
      '1.02:0502',
      `1.03:${cntValue}`,
    ].join(String.fromCharCode(GS)) + String.fromCharCode(FS);
    const type2Body = `2.01:7${String.fromCharCode(FS)}`;
    const buf = Buffer.from(type1Content + type2Body, 'ascii');
    const eft = parseEft(buf);
    // The field without colon is silently skipped
    expect(eft.type1).toHaveProperty('1.02');
    expect(eft.type1).not.toHaveProperty('nocolon');
  });

  it('uses Unknown fallback for unrecognized impression/finger/compression codes', () => {
    const type4 = buildType4Record(0, { len: 22, imp: 99, fgp: 99, cga: 99 });
    const buf = buildEftWithType4(type4, 0);
    const eft = parseEft(buf);
    const rec = eft.type4Records[0];
    expect(rec.impressionName).toBe('Unknown (99)');
    expect(rec.fingerName).toBe('Unknown (99)');
    expect(rec.compressionName).toBe('Unknown (99)');
  });

  it('uses raw ISR value when non-zero', () => {
    const type4 = buildType4Record(0, { len: 22, isr: 250 });
    const buf = buildEftWithType4(type4, 0);
    const eft = parseEft(buf);
    expect(eft.type4Records[0].ppi).toBe(250);
  });
});
