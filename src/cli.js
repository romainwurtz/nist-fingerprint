#!/usr/bin/env node

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import pc from 'picocolors';
import Table from 'cli-table3';
import { parseEft, formatDate, titleCase } from './eft-parser.js';
import { decodeWsq } from './wsq-decoder.js';
import { toTiff, toPng, exportFilename } from './image-export.js';
import { filterRecords, formatHeight } from './helpers.js';
import { SEX_CODES, EYE_COLORS, HAIR_COLORS } from './constants.js';

function withErrorHandling(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(pc.red(err.message));
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name('nist-fingerprint')
  .description('View and export fingerprint images from ANSI/NIST-ITL EFT files')
  .version(pkg.version);

// Default command (no subcommand) → info
program
  .argument('[file]', 'EFT file to inspect')
  .action(async (file) => {
    if (file) {
      await withErrorHandling(showInfo)(file);
    } else {
      program.help();
    }
  });

// info subcommand
program
  .command('info <file>')
  .description('Display EFT file metadata and fingerprint summary')
  .action(withErrorHandling(showInfo));

// view subcommand
program
  .command('view <file>')
  .description('Display fingerprint images in the terminal')
  .option('-f, --finger <finger>', 'Finger position number or name (e.g. 1, right_thumb)')
  .action(withErrorHandling(async (file, opts) => {
    if (!process.stdout.isTTY) {
      console.error(pc.yellow('Terminal display requires a TTY. Use "nist-fingerprint export" to save images to files.'));
      process.exit(1);
    }
    await showView(file, opts);
  }));

// export subcommand
program
  .command('export <file>')
  .description('Export fingerprint images as TIFF or PNG files')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-f, --finger <finger>', 'Finger position number or name (e.g. 1, right_thumb)')
  .addOption(new Option('--format <format>', 'Image format').choices(['tiff', 'png']).default('tiff'))
  .action(withErrorHandling(doExport));

program.parse();

// ---- Commands ----

function showInfo(filePath) {
  const absPath = resolve(filePath);
  const buf = readFileSync(absPath);
  const eft = parseEft(buf);
  const t2 = eft.type2;

  const fileName = basename(absPath);

  console.log();
  console.log(pc.bold(`EFT Fingerprint File: ${fileName}`));
  console.log();

  const info = [];
  if (t2.fullName) info.push(['Name', pc.cyan(t2.fullName)]);
  if (t2.dob) info.push(['Date of Birth', formatDate(t2.dob)]);
  if (t2.sex) info.push(['Sex', SEX_CODES[t2.sex] || t2.sex]);
  if (t2.eyeColor) info.push(['Eye Color', EYE_COLORS[t2.eyeColor] || t2.eyeColor]);
  if (t2.hairColor) info.push(['Hair Color', HAIR_COLORS[t2.hairColor] || t2.hairColor]);
  if (t2.height) info.push(['Height', formatHeight(t2.height)]);
  if (t2.weight) info.push(['Weight', `${t2.weight} lbs`]);
  if (t2.address) info.push(['Address', t2.address]);
  if (t2.purpose) info.push(['Purpose', titleCase(t2.purpose)]);
  if (t2.scanner) info.push(['Scanner', `${t2.scanner.make} ${t2.scanner.model}`]);
  if (t2.dateCaptured) info.push(['Date Captured', formatDate(t2.dateCaptured)]);

  for (const [label, value] of info) {
    console.log(`  ${pc.dim(label.padEnd(16))} ${value}`);
  }

  // Fingerprints summary
  const rolled = eft.type4Records.filter(r => r.fingerPosition <= 10).length;
  const plain = eft.type4Records.filter(r => r.fingerPosition > 10).length;
  const comprName = eft.type4Records[0]?.compressionName || 'Unknown';
  const ppi = eft.type4Records[0]?.ppi || 500;

  console.log();
  console.log(`  ${pc.dim('Fingerprints'.padEnd(16))} ${eft.type4Records.length} images (${rolled} rolled, ${plain} plain) — ${comprName} @ ${ppi} PPI`);
  console.log();

  // Fingerprint table
  const table = new Table({
    head: ['#', 'Finger', 'Size', 'Type', 'Compression'].map(h => pc.dim(h)),
    style: { head: [], border: [] },
  });

  for (const rec of eft.type4Records) {
    table.push([
      rec.fingerPosition,
      rec.fingerName,
      `${rec.width}x${rec.height}`,
      rec.impressionName,
      rec.compressionName,
    ]);
  }

  console.log(table.toString());
  console.log();
}

async function showView(filePath, opts) {
  const absPath = resolve(filePath);
  const buf = readFileSync(absPath);
  const eft = parseEft(buf);

  const records = filterRecords(eft.type4Records, opts.finger);

  // Dynamic import since terminal-image is ESM-only
  const termImg = await import('terminal-image');

  for (const rec of records) {
    console.log();
    console.log(pc.bold(`${rec.fingerName} (${rec.width}x${rec.height})`));

    const decoded = decodeWsq(rec.imageData);
    const pngBuf = await toPng(decoded.pixels, decoded.width, decoded.height);
    const rendered = await termImg.default.buffer(pngBuf, {
      width: '50%',
      preserveAspectRatio: true,
    });
    console.log(rendered);
  }
}

async function doExport(filePath, opts) {
  const absPath = resolve(filePath);
  const buf = readFileSync(absPath);
  const eft = parseEft(buf);

  const records = filterRecords(eft.type4Records, opts.finger);
  const format = opts.format.toLowerCase();
  const outDir = resolve(opts.output);

  mkdirSync(outDir, { recursive: true });

  console.log();
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const progress = pc.dim(`[${i + 1}/${records.length}]`);
    process.stdout.write(`  ${progress} Decoding ${rec.fingerName}...`);

    const decoded = decodeWsq(rec.imageData);
    const filename = exportFilename(rec.fingerPosition, format);
    const outPath = resolve(outDir, filename);

    let imgBuf;
    if (format === 'png') {
      imgBuf = await toPng(decoded.pixels, decoded.width, decoded.height);
    } else {
      imgBuf = await toTiff(decoded.pixels, decoded.width, decoded.height, rec.ppi);
    }

    writeFileSync(outPath, imgBuf);
    process.stdout.write(` ${pc.green('saved')} ${pc.dim(filename)}\n`);
  }
  console.log();
  console.log(`  ${pc.green('Done!')} ${records.length} images exported to ${pc.cyan(outDir)}`);
  console.log();
}
