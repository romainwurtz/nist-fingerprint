import { FINGER_NAMES, FINGER_ALIASES } from './constants.js';
import { ValidationError } from './errors.js';

/**
 * Resolve a CLI finger argument to a numeric position.
 * Accepts a number (1-14), a name like "right_thumb", or null.
 * @param {string|null} finger - Finger position number or name
 * @returns {number|null} Finger position number, or null if no filter
 * @throws {ValidationError} If the finger name/number is not recognized
 */
export function resolveFingerPosition(finger) {
  if (!finger) return null;

  // Try as number
  const num = parseInt(finger, 10);
  if (!isNaN(num) && FINGER_NAMES[num]) return num;

  // Try as alias
  const alias = finger.toLowerCase().replace(/[\s-]/g, '_');
  if (FINGER_ALIASES[alias]) return FINGER_ALIASES[alias];

  throw new ValidationError(`Unknown finger: "${finger}". Use a number (1-14) or name (e.g. right_thumb, left_index).`);
}

/**
 * Filter Type-4 records by finger position.
 * @param {Array} records - Array of Type-4 fingerprint records
 * @param {string|null} fingerOpt - Finger position number or name, or null for all
 * @returns {Array} Filtered records
 * @throws {ValidationError} If no record matches the requested position
 */
export function filterRecords(records, fingerOpt) {
  if (!fingerOpt) return records;

  const pos = resolveFingerPosition(fingerOpt);
  const filtered = records.filter(r => r.fingerPosition === pos);
  if (filtered.length === 0) {
    throw new ValidationError(`No fingerprint record found for position ${pos} (${FINGER_NAMES[pos]})`);
  }
  return filtered;
}

/**
 * Format a height string from "FMM" (e.g. "602") to "6'02\"".
 * @param {string} heightStr - Height in FMM format
 * @returns {string} Formatted height string
 */
export function formatHeight(heightStr) {
  // Height in format "FMM" (e.g. "602" = 6'02")
  if (!heightStr || heightStr.length < 3) return heightStr;
  if (!/^\d{3,4}$/.test(heightStr)) return heightStr;
  const feet = heightStr[0];
  const inches = parseInt(heightStr.substring(1), 10);
  return `${feet}'${String(inches).padStart(2, '0')}"`;
}
