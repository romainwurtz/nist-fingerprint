import { describe, it, expect } from 'vitest';
import { decodeWsq } from '../src/wsq-decoder.js';
import { WsqDecodeError } from '../src/errors.js';
import { parseEft } from '../src/eft-parser.js';
import { eftBuf } from './fixture.js';

const eft = parseEft(eftBuf);
const realWsq = eft.type4Records[0].imageData;

/**
 * Find the byte offset of a 2-byte WSQ marker in a buffer.
 * @param {Uint8Array} buf - Buffer to search
 * @param {number} marker - 16-bit marker value (e.g. 0xFFA4)
 * @param {number} [startFrom=0] - Offset to begin searching
 * @returns {number} Byte offset of the marker, or -1 if not found
 */
function findMarker(buf, marker, startFrom = 0) {
  const hi = (marker >> 8) & 0xff;
  const lo = marker & 0xff;
  for (let i = startFrom; i < buf.length - 1; i++) {
    if (buf[i] === hi && buf[i + 1] === lo) return i;
  }
  return -1;
}

describe('WSQ edge cases', () => {
  it('throws WsqDecodeError on 1-byte buffer', () => {
    expect(() => decodeWsq(Buffer.alloc(1))).toThrow(WsqDecodeError);
  });

  it('throws WsqDecodeError on wrong SOI marker', () => {
    expect(() => decodeWsq(Buffer.from([0xff, 0xb0, 0x00, 0x00]))).toThrow(WsqDecodeError);
    expect(() => decodeWsq(Buffer.from([0xff, 0xb0, 0x00, 0x00]))).toThrow(/SOI/);
  });

  it('throws WsqDecodeError when truncated after valid SOI', () => {
    expect(() => decodeWsq(Buffer.from([0xff, 0xa0]))).toThrow(WsqDecodeError);
    expect(() => decodeWsq(Buffer.from([0xff, 0xa0]))).toThrow(/end of data/);
  });

  it('throws WsqDecodeError on sliced real WSQ (truncated)', () => {
    expect(() => decodeWsq(realWsq.slice(0, 100))).toThrow(WsqDecodeError);
  });

  it('all decoded pixels are in 0-255 range', () => {
    const { pixels } = decodeWsq(realWsq);
    for (let i = 0; i < pixels.length; i++) {
      expect(pixels[i], `pixel[${i}] = ${pixels[i]} out of range`).toBeGreaterThanOrEqual(0);
      expect(pixels[i], `pixel[${i}] = ${pixels[i]} out of range`).toBeLessThanOrEqual(255);
    }
  });

  it('decoding is deterministic (same input → same output)', () => {
    const a = decodeWsq(realWsq);
    const b = decodeWsq(realWsq);
    expect(Buffer.compare(Buffer.from(a.pixels), Buffer.from(b.pixels))).toBe(0);
  });

  it('throws on invalid table marker before SOF', () => {
    const buf = Buffer.from(realWsq);
    const dttPos = findMarker(buf, 0xffa4);
    expect(dttPos).toBeGreaterThan(0);
    // Replace DTT marker with an invalid marker 0xFFAF
    buf[dttPos] = 0xff;
    buf[dttPos + 1] = 0xaf;
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/No SOF, Table, or comment/);
  });

  it('throws on invalid marker after SOF (post-SOF)', () => {
    const buf = Buffer.from(realWsq);
    // Find first SOB marker (0xFFA3) — it comes after SOF
    const sobPos = findMarker(buf, 0xffa3);
    expect(sobPos).toBeGreaterThan(0);
    // Replace SOB with invalid marker 0xFFAF
    buf[sobPos] = 0xff;
    buf[sobPos + 1] = 0xaf;
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/No SOB, Table, or comment/);
  });

  it('throws on invalid table type in getCTableWSQ', () => {
    const buf = Buffer.from(realWsq);
    const dttPos = findMarker(buf, 0xffa4);
    expect(dttPos).toBeGreaterThan(0);
    // Replace DTT (0xFFA4) with EOI (0xFFA1) — passes TBLS_N_SOF validation
    // but is not handled by getCTableWSQ's switch statement
    buf[dttPos] = 0xff;
    buf[dttPos + 1] = 0xa1;
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/Invalid table marker/);
  });

  it('throws when DQT table is missing (replaced with COM)', () => {
    const buf = Buffer.from(realWsq);
    const dqtPos = findMarker(buf, 0xffa5);
    expect(dqtPos).toBeGreaterThan(0);
    // Read the length field right after the marker to verify it covers the payload
    const payloadLen = (buf[dqtPos + 2] << 8) | buf[dqtPos + 3];
    expect(payloadLen).toBeGreaterThan(0);
    // Replace DQT marker with COM (0xFFA8) — the parser will skip it as a comment
    buf[dqtPos] = 0xff;
    buf[dqtPos + 1] = 0xa8;
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/Quantization table not defined/);
  });

  it('throws when DTT table is missing (replaced with COM)', () => {
    const buf = Buffer.from(realWsq);
    const dttPos = findMarker(buf, 0xffa4);
    expect(dttPos).toBeGreaterThan(0);
    // Read the length field right after the marker to verify it covers the payload
    const payloadLen = (buf[dttPos + 2] << 8) | buf[dttPos + 3];
    expect(payloadLen).toBeGreaterThan(0);
    // Replace DTT marker with COM (0xFFA8)
    buf[dttPos] = 0xff;
    buf[dttPos + 1] = 0xa8;
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/filter coefficients not defined/);
  });

  it('throws when truncated at readShort (3 bytes: valid SOI + 1)', () => {
    const buf = Buffer.from([0xff, 0xa0, 0xff]);
    expect(() => decodeWsq(buf)).toThrow(WsqDecodeError);
    expect(() => decodeWsq(buf)).toThrow(/end of data/);
  });
});
