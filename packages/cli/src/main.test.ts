import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from './main.js';

let cwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'terrarium-cli-'));
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('terrarium CLI', () => {
  it('runs up fintech and status', async () => {
    await main(['node', 'terrarium', 'up', 'fintech', '--seed', '42']);
    await main(['node', 'terrarium', 'status']);
    await main([
      'node',
      'terrarium',
      'inject',
      'transfer',
      '--from',
      'acct_0001',
      '--to',
      'acct_0002',
      '--amount',
      '1000',
    ]);
    await expect(main(['node', 'terrarium', 'replay'])).resolves.toBeUndefined();
  });
});