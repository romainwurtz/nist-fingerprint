import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

describe('public API contract', () => {
  it('exports all expected names with correct types', () => {
    // Errors
    expect(api.EftError).toBeTypeOf('function');
    expect(api.EftParseError).toBeTypeOf('function');
    expect(api.WsqDecodeError).toBeTypeOf('function');
    expect(api.ValidationError).toBeTypeOf('function');

    // Parser
    expect(api.parseEft).toBeTypeOf('function');
    expect(api.formatDate).toBeTypeOf('function');
    expect(api.titleCase).toBeTypeOf('function');

    // WSQ
    expect(api.decodeWsq).toBeTypeOf('function');

    // Image export
    expect(api.toTiff).toBeTypeOf('function');
    expect(api.toPng).toBeTypeOf('function');
    expect(api.exportFilename).toBeTypeOf('function');

    // Helpers
    expect(api.resolveFingerPosition).toBeTypeOf('function');
    expect(api.filterRecords).toBeTypeOf('function');
    expect(api.formatHeight).toBeTypeOf('function');

    // Constants — lookup objects
    expect(api.FINGER_NAMES).toBeTypeOf('object');
    expect(api.FINGER_ALIASES).toBeTypeOf('object');
    expect(api.FINGER_SLUGS).toBeTypeOf('object');
    expect(api.SEX_CODES).toBeTypeOf('object');
    expect(api.RACE_CODES).toBeTypeOf('object');
    expect(api.EYE_COLORS).toBeTypeOf('object');
    expect(api.HAIR_COLORS).toBeTypeOf('object');
    expect(api.COMPRESSION_TYPES).toBeTypeOf('object');
    expect(api.IMPRESSION_TYPES).toBeTypeOf('object');

    // Constants — delimiters
    expect(api.FS).toBeTypeOf('number');
    expect(api.GS).toBeTypeOf('number');
    expect(api.RS).toBeTypeOf('number');
    expect(api.US).toBeTypeOf('number');

    // Verify total export count (no accidental additions)
    expect(Object.keys(api)).toHaveLength(27);
  });
});
