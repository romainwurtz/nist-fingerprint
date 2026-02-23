import sharp from 'sharp';
import { FINGER_SLUGS } from './constants.js';

/**
 * Convert raw grayscale pixels to a TIFF buffer.
 * @param {Uint8Array} pixels - Raw grayscale pixel data
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @param {number} [ppi=500] - Resolution in pixels per inch
 * @returns {Promise<Buffer>} TIFF image buffer
 */
export async function toTiff(pixels, width, height, ppi = 500) {
  return sharp(pixels, {
    raw: { width, height, channels: 1 },
  })
    .tiff({ compression: 'lzw' })
    .withMetadata({ density: ppi })
    .toBuffer();
}

/**
 * Convert raw grayscale pixels to a PNG buffer.
 * @param {Uint8Array} pixels - Raw grayscale pixel data
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function toPng(pixels, width, height) {
  return sharp(pixels, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
}

/**
 * Generate the export filename for a finger.
 * @param {number} fingerPosition - Finger position number (1-14)
 * @param {string} [format='tiff'] - Image format extension
 * @returns {string} Filename like "01-right-thumb.tiff"
 */
export function exportFilename(fingerPosition, format = 'tiff') {
  const num = String(fingerPosition).padStart(2, '0');
  const slug = FINGER_SLUGS[fingerPosition] || `finger-${fingerPosition}`;
  return `${num}-${slug}.${format}`;
}
