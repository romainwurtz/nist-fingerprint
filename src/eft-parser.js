import { FS, GS, RS, US, FINGER_NAMES, COMPRESSION_TYPES, IMPRESSION_TYPES } from './constants.js';
import { EftParseError } from './errors.js';

const TYPE4_HEADER_SIZE = 18;

/**
 * Parse an ANSI/NIST-ITL EFT file from a Buffer.
 * @param {Buffer|Uint8Array} buf - Raw EFT file data
 * @returns {{ type1: Object, type2: Object, type4Records: Array, fileSize: number }}
 */
export function parseEft(buf) {
  let offset = 0;

  // --- Type-1 Record (ASCII, GS-delimited fields, FS-terminated) ---
  const type1 = parseAsciiRecord(buf, offset, 1);
  offset += type1.length;

  // Parse CNT field (1.03) to determine subsequent records
  const cntField = type1.fields['1.03'];
  const recordList = parseCnt(cntField);

  // --- Type-2 Record (ASCII, GS-delimited fields, FS-terminated) ---
  const type2 = parseAsciiRecord(buf, offset, 2);
  offset += type2.length;

  // --- Type-4 Records (binary, fixed 18-byte header + image data) ---
  const type4Records = [];
  for (const entry of recordList) {
    if (entry.type === 2) continue;
    if (entry.type !== 4) {
      throw new EftParseError(
        `Unsupported record type ${entry.type} (IDC ${entry.idc}). Only Type-1, Type-2, and Type-4 are supported.`,
        { recordType: entry.type }
      );
    }

    const rec = parseType4(buf, offset, entry.idc);
    type4Records.push(rec);
    offset += rec.length;
  }

  return {
    type1: type1.fields,
    type2: parseType2Demographics(type2.fields),
    type4Records,
    fileSize: buf.length,
  };
}

/**
 * Parse an ASCII record (Type-1 or Type-2).
 * Fields are GS-separated, record ends with FS.
 */
function parseAsciiRecord(buf, offset, recordType) {
  // First field gives length: "N.01:LEN"
  const lenFieldTag = `${recordType}.01`;

  // Find FS terminator
  const fsPos = buf.indexOf(FS, offset);
  if (fsPos === -1) {
    // FS might be the last byte included in length
    throw new EftParseError(`No FS terminator found for Type-${recordType} record`, { offset, recordType });
  }

  // The FS byte is included in the record length
  const recordBuf = buf.subarray(offset, fsPos + 1);

  // Split on GS to get fields (exclude trailing FS)
  const ascii = recordBuf.subarray(0, recordBuf.length - 1).toString('ascii');
  const fieldStrs = ascii.split(String.fromCharCode(GS));

  const fields = {};
  let recordLength = 0;

  for (const fieldStr of fieldStrs) {
    const colonIdx = fieldStr.indexOf(':');
    if (colonIdx === -1) continue;
    const tag = fieldStr.substring(0, colonIdx);
    const value = fieldStr.substring(colonIdx + 1);
    fields[tag] = value;

    if (tag === lenFieldTag) {
      recordLength = parseInt(value, 10);
    }
  }

  // Use parsed length (includes FS byte)
  if (!recordLength) {
    recordLength = fsPos - offset + 1;
  }

  return { fields, length: recordLength };
}

/**
 * Parse the CNT field (1.03).
 * Format: "<type>US<total_count>RS<type>US<idc>RS<type>US<idc>..."
 * First subfield is special: type + total count (not a type/IDC pair).
 */
function parseCnt(cntValue) {
  if (!cntValue) {
    throw new EftParseError('Missing CNT field (1.03) in Type-1 record', { recordType: 1 });
  }
  const subfields = cntValue.split(String.fromCharCode(RS));
  const records = [];

  for (let i = 1; i < subfields.length; i++) {
    const parts = subfields[i].split(String.fromCharCode(US));
    const type = parseInt(parts[0], 10);
    const idc = parseInt(parts[1], 10);
    if (isNaN(type) || isNaN(idc)) {
      throw new EftParseError(`Malformed CNT subfield: "${subfields[i]}"`, { recordType: 1 });
    }
    records.push({ type, idc });
  }

  return records;
}

/**
 * Parse Type-2 demographic fields into a structured object.
 */
function parseType2Demographics(fields) {
  const raw = { ...fields };

  // Parse name (2.018): "LAST,FIRST MIDDLE" → structured
  let name = null;
  if (fields['2.018']) {
    const nameParts = fields['2.018'].split(',');
    const lastName = titleCase(nameParts[0]?.trim() || '');
    const firstMiddle = nameParts[1]?.trim() || '';
    const firstMiddleParts = firstMiddle.split(/\s+/);
    const firstName = titleCase(firstMiddleParts[0] || '');
    const middleName = titleCase(firstMiddleParts.slice(1).join(' '));
    name = { first: firstName, middle: middleName, last: lastName };
  }

  // Parse date of birth (2.022): "YYYYMMDD"
  const dob = fields['2.022'] ? parseDate(fields['2.022']) : null;

  // Scanner info (2.067): "Make US Model US Serial"
  let scanner = null;
  if (fields['2.067']) {
    const parts = fields['2.067'].split(String.fromCharCode(US));
    scanner = {
      make: parts[0] || '',
      model: parts[1] || '',
      serial: parts[2] || '',
    };
  }

  return {
    raw,
    name,
    fullName: name ? [name.first, name.middle, name.last].filter(Boolean).join(' ') : null,
    dob,
    sex: fields['2.024'] || null,
    race: fields['2.025'] || null,
    height: fields['2.027'] || null,
    weight: fields['2.029'] ? parseInt(fields['2.029'], 10) : null,
    eyeColor: fields['2.031'] || null,
    hairColor: fields['2.032'] || null,
    purpose: fields['2.037'] || null,
    dateCaptured: fields['2.038'] ? parseDate(fields['2.038']) : null,
    address: fields['2.041'] || null,
    scanner,
  };
}

/**
 * Parse a Type-4 binary fingerprint record.
 * Fixed 18-byte header followed by image data.
 */
function parseType4(buf, offset, expectedIdc) {
  if (offset + TYPE4_HEADER_SIZE > buf.length) {
    throw new EftParseError(
      `Type-4 record at offset ${offset} exceeds buffer (need ${TYPE4_HEADER_SIZE} bytes, have ${buf.length - offset})`,
      { offset, recordType: 4 },
    );
  }
  const len = buf.readUInt32BE(offset);
  if (len < TYPE4_HEADER_SIZE) {
    throw new EftParseError(`Type-4 record length ${len} is smaller than header size`, { offset, recordType: 4 });
  }
  if (offset + len > buf.length) {
    throw new EftParseError(
      `Type-4 record at offset ${offset} exceeds buffer (claims ${len} bytes, have ${buf.length - offset})`,
      { offset, recordType: 4 },
    );
  }
  const idc = buf[offset + 4];
  if (idc !== expectedIdc) {
    throw new EftParseError(`Type-4 IDC mismatch at offset ${offset}: expected ${expectedIdc}, got ${idc}`, { offset, recordType: 4 });
  }
  const imp = buf[offset + 5];
  const fgp = buf[offset + 6]; // Finger position (first byte of 6-byte FGP field)
  const isr = buf[offset + 12]; // Image scanning resolution (0 = 500ppi)
  const hll = buf.readUInt16BE(offset + 13); // Horizontal line length (width)
  const vll = buf.readUInt16BE(offset + 15); // Vertical line length (height)
  const cga = buf[offset + 17]; // Compression algorithm

  const imageData = buf.subarray(offset + TYPE4_HEADER_SIZE, offset + len);

  return {
    length: len,
    idc,
    impressionType: imp,
    impressionName: IMPRESSION_TYPES[imp] || `Unknown (${imp})`,
    fingerPosition: fgp,
    fingerName: FINGER_NAMES[fgp] || `Unknown (${fgp})`,
    ppi: isr === 0 ? 500 : isr,
    width: hll,
    height: vll,
    compression: cga,
    compressionName: COMPRESSION_TYPES[cga] || `Unknown (${cga})`,
    imageData,
  };
}

/**
 * Convert a string to Title Case.
 * @param {string} str - Input string
 * @returns {string} Title-cased string
 */
export function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseDate(yyyymmdd) {
  const y = parseInt(yyyymmdd.substring(0, 4), 10);
  const m = parseInt(yyyymmdd.substring(4, 6), 10);
  const d = parseInt(yyyymmdd.substring(6, 8), 10);
  return { year: y, month: m, day: d };
}

/**
 * Format a parsed date object as a human-readable string.
 * @param {{ year: number, month: number, day: number }|null} dateObj - Parsed date
 * @returns {string} Formatted date string, or "Unknown" if null
 */
export function formatDate(dateObj) {
  if (!dateObj) return 'Unknown';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthName = months[dateObj.month - 1] || 'Unknown';
  return `${monthName} ${dateObj.day}, ${dateObj.year}`;
}
