import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const eftBuf = readFileSync(resolve(__dirname, '..', 'samples', 'sample.eft'));
