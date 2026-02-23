import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, '..', 'src', 'cli.js');
const fixture = resolve(__dirname, '..', 'samples', 'sample.eft');

describe('CLI', () => {
  it('--version prints semver', () => {
    const out = execFileSync('node', [cli, '--version'], { encoding: 'utf8' });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help mentions nist-fingerprint', () => {
    const out = execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
    expect(out).toContain('nist-fingerprint');
  });

  it('info command works with fixture', () => {
    const out = execFileSync('node', [cli, 'info', fixture], { encoding: 'utf8' });
    expect(out).toContain('Michael Scott');
  });

  it('export rejects invalid format', () => {
    expect(
      () => execFileSync('node', [cli, 'export', fixture, '--format', 'jpeg'], { encoding: 'utf8' }),
    ).toThrow();
  });

  it('export --format png creates files with PNG magic bytes', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eft-test-'));
    try {
      execFileSync('node', [cli, 'export', fixture, '--output', tmpDir, '--format', 'png'], { encoding: 'utf8' });
      const files = readFileSync(join(tmpDir, '06-left-thumb.png'));
      // PNG magic bytes: 0x89 0x50 0x4E 0x47
      expect(files[0]).toBe(0x89);
      expect(files[1]).toBe(0x50);
      expect(files[2]).toBe(0x4e);
      expect(files[3]).toBe(0x47);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits with error for non-existent file', () => {
    expect.assertions(2);
    try {
      execFileSync('node', [cli, 'info', '/no/such/file.eft'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      expect(err.status, 'exit code should be non-zero').not.toBe(0);
      expect(err.stderr.length > 0 || err.stdout.length > 0, 'should produce output').toBe(true);
    }
  });
});
