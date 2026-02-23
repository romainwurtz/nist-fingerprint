import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseEft } from '../src/eft-parser.js';
import { decodeWsq } from '../src/wsq-decoder.js';
import { WsqDecodeError } from '../src/errors.js';
import { eftBuf } from './fixture.js';

const eft = parseEft(eftBuf);

describe('decodeWsq', () => {
  it('decodes Left Thumb with correct dimensions', () => {
    const rec = eft.type4Records[0];
    const decoded = decodeWsq(rec.imageData);
    expect(decoded.width).toBe(545);
    expect(decoded.height).toBe(622);
    expect(decoded.pixels.length).toBe(545 * 622);
  });

  it('produces non-uniform pixel data (proves real decoding)', () => {
    const rec = eft.type4Records[0];
    const { pixels } = decodeWsq(rec.imageData);
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) sum += pixels[i];
    const mean = sum / pixels.length;
    let variance = 0;
    for (let i = 0; i < pixels.length; i++) variance += (pixels[i] - mean) ** 2;
    variance /= pixels.length;
    // Real fingerprint data has significant variance; zero-fill or constant-fill would be ~0
    expect(variance, `Pixel variance too low (${variance.toFixed(2)}), likely not real decoded data`).toBeGreaterThan(100);
  });

  it('matches golden hash for Left Thumb', () => {
    const rec = eft.type4Records[0];
    const decoded = decodeWsq(rec.imageData);
    const hash = createHash('sha256').update(decoded.pixels).digest('hex');
    expect(hash).toBe('73b3806ddc4f68bbb70290f030d0f753bbbf35bea70eb8d5fe13f12fc9308b6e');
  });

  it('decodes all images without error', () => {
    for (const rec of eft.type4Records) {
      const decoded = decodeWsq(rec.imageData);
      expect(decoded.width > 0).toBeTruthy();
      expect(decoded.height > 0).toBeTruthy();
      expect(decoded.pixels.length).toBe(decoded.width * decoded.height);
    }
  });
});

describe('decodeWsq — negative', () => {
  it('throws WsqDecodeError on invalid data', () => {
    expect(() => decodeWsq(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(WsqDecodeError);
    expect(() => decodeWsq(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(/WSQ/);
  });

  it('throws WsqDecodeError on empty buffer', () => {
    expect(() => decodeWsq(Buffer.alloc(0))).toThrow(WsqDecodeError);
    expect(() => decodeWsq(Buffer.alloc(0))).toThrow(/WSQ/);
  });
});
