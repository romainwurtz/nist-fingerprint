#!/usr/bin/env node

/**
 * Generate a minimal EFT test fixture from a public-domain JNBIS sample WSQ.
 *
 * Downloads sample.wsq from the JNBIS repo (Apache 2.0, NIST public-domain fingerprint),
 * decodes it to determine width/height, then builds a valid ANSI/NIST-ITL EFT file
 * with Type-1, Type-2, and 2 Type-4 records.
 *
 * Run once, commit the result: samples/sample.eft
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWsq } from '../src/wsq-decoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WSQ_URL = 'https://raw.githubusercontent.com/mhshams/jnbis/main/src/test/resources/samples/wsq/sample.wsq';
const OUTPUT = resolve(__dirname, '..', 'samples', 'sample.eft');

// ANSI/NIST-ITL delimiters
const FS = 0x1c;
const GS = 0x1d;
const RS = 0x1e;
const US = 0x1f;

function buildAsciiRecord(recordType, fields) {
  // fields: array of [tag, value] pairs (tag is just the number, e.g. '01')
  // The length field (X.01) will be computed automatically.
  const lenTag = `${recordType}.01`;
  const pairs = [[lenTag, '0'], ...fields]; // placeholder length

  // Build string without length first to measure
  const withoutLen = pairs.slice(1)
    .map(([tag, val]) => `${tag}:${val}`)
    .join(String.fromCharCode(GS));

  // Total: "T.01:LEN" + GS + rest + FS
  const prefix = `${lenTag}:`;
  // We need to iterate because the length includes itself
  let lenStr;
  for (let guess = 10; guess < 10000; guess++) {
    const candidate = `${prefix}${guess}${String.fromCharCode(GS)}${withoutLen}${String.fromCharCode(FS)}`;
    if (candidate.length === guess) {
      lenStr = candidate;
      break;
    }
  }

  if (!lenStr) throw new Error('Could not compute record length');
  return Buffer.from(lenStr, 'ascii');
}

function buildType4(idc, fingerPosition, impressionType, wsqData, width, height) {
  // 18-byte fixed header + image data
  const len = 18 + wsqData.length;
  const header = Buffer.alloc(18);

  header.writeUInt32BE(len, 0);         // Length
  header[4] = idc;                       // IDC
  header[5] = impressionType;            // Impression type
  header[6] = fingerPosition;            // Finger position (first byte of 6-byte FGP)
  // bytes 7-11: remaining FGP bytes (0)
  header[12] = 0;                        // ISR: 0 = 500 PPI
  header.writeUInt16BE(width, 13);       // HLL (horizontal line length)
  header.writeUInt16BE(height, 15);      // VLL (vertical line length)
  header[17] = 1;                        // CGA: 1 = WSQ

  return Buffer.concat([header, wsqData]);
}

async function main() {
  console.log('Downloading sample.wsq from JNBIS...');
  const resp = await fetch(WSQ_URL);
  if (!resp.ok) throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
  const wsqData = Buffer.from(await resp.arrayBuffer());
  console.log(`  Downloaded ${wsqData.length} bytes`);

  // Decode to get width/height
  const { width, height } = decodeWsq(wsqData);
  console.log(`  WSQ image: ${width}x${height}`);

  // Type-1 record
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const type1Buf = buildAsciiRecord(1, [
    ['1.02', '0502'],                          // Version
    ['1.03', `1${c(US)}2${c(RS)}2${c(US)}0${c(RS)}4${c(US)}1`], // CNT: 1 Type-2 + 1 Type-4
    ['1.04', 'CRM'],                           // Type of transaction
    ['1.05', today],                           // Date
    ['1.07', 'TESTORI'],                       // Originating agency
    ['1.08', 'TESTDEST'],                      // Destination agency
    ['1.09', 'TESTCASE001'],                   // TCN
    ['1.11', `${String(width).padStart(4, '0')}${String(height).padStart(4, '0')}`], // NSR/NTR
    ['1.12', `${String(width).padStart(4, '0')}${String(height).padStart(4, '0')}`],
  ]);

  // Type-2 record
  const type2Buf = buildAsciiRecord(2, [
    ['2.02', '0'],                                // IDC
    ['2.018', 'SCOTT,MICHAEL'],                     // Name
    ['2.022', '19620315'],                         // DOB
    ['2.024', 'M'],                                // Sex
    ['2.025', 'W'],                                // Race
    ['2.027', '511'],                              // Height (5'11")
    ['2.029', '185'],                              // Weight
    ['2.031', 'BRO'],                              // Eye color
    ['2.032', 'BRO'],                              // Hair color
    ['2.037', 'CRIMINAL'],                         // Purpose
    ['2.038', today],                              // Date captured
    ['2.041', '1725 SLOUGH AVE, SCRANTON, PA 18505'], // Address
    ['2.067', `TESTSCAN${c(US)}MODEL1${c(US)}SN001`], // Scanner
  ]);

  // Type-4 record: position 6 (left thumb, rolled)
  const type4_1 = buildType4(1, 6, 1, wsqData, width, height);  // IDC=1, pos=6, rolled

  const eftBuf = Buffer.concat([type1Buf, type2Buf, type4_1]);

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, eftBuf);
  console.log(`\nWrote ${eftBuf.length} bytes to ${OUTPUT}`);
  console.log('Done!');
}

function c(byte) {
  return String.fromCharCode(byte);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
