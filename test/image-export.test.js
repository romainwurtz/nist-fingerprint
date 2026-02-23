import { describe, it, expect } from 'vitest';
import { parseEft } from '../src/eft-parser.js';
import { decodeWsq } from '../src/wsq-decoder.js';
import { toTiff, toPng, exportFilename } from '../src/image-export.js';
import { eftBuf } from './fixture.js';

const eft = parseEft(eftBuf);

describe('toTiff', () => {
  it('returns a Buffer with TIFF magic bytes', async () => {
    const rec = eft.type4Records[0];
    const decoded = decodeWsq(rec.imageData);
    const buf = await toTiff(decoded.pixels, decoded.width, decoded.height);
    expect(Buffer.isBuffer(buf)).toBeTruthy();
    // TIFF magic: 0x49 0x49 (little-endian) or 0x4D 0x4D (big-endian)
    const magic = buf.readUInt16BE(0);
    expect(magic === 0x4949 || magic === 0x4D4D, `Unexpected TIFF magic: 0x${magic.toString(16)}`).toBeTruthy();
  });
});

describe('toPng', () => {
  it('returns a Buffer with PNG magic bytes', async () => {
    const rec = eft.type4Records[0];
    const decoded = decodeWsq(rec.imageData);
    const buf = await toPng(decoded.pixels, decoded.width, decoded.height);
    expect(Buffer.isBuffer(buf)).toBeTruthy();
    // PNG magic: 0x89 0x50 0x4E 0x47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });
});

describe('exportFilename', () => {
  it('generates correct TIFF filename', () => {
    expect(exportFilename(1, 'tiff')).toBe('01-right-thumb.tiff');
  });

  it('generates correct PNG filename', () => {
    expect(exportFilename(14, 'png')).toBe('14-plain-left-four.png');
  });

  it('zero-pads single digit positions', () => {
    expect(exportFilename(3, 'tiff')).toBe('03-right-middle.tiff');
  });

  it('defaults to tiff format', () => {
    expect(exportFilename(1)).toBe('01-right-thumb.tiff');
  });

  it('falls back to generic slug for unknown finger position', () => {
    expect(exportFilename(99)).toBe('99-finger-99.tiff');
  });
});

describe('full pipeline', () => {
  it('parse → decode → PNG export produces valid image', async () => {
    const rec = eft.type4Records[0];
    const decoded = decodeWsq(rec.imageData);
    const png = await toPng(decoded.pixels, decoded.width, decoded.height);

    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    // Non-trivial size (a real image, not empty)
    expect(png.length, `PNG too small: ${png.length} bytes`).toBeGreaterThan(1000);
  });
});
