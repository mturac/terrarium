import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPersistedWorld } from '@terrarium/core';
import { main } from './main.js';

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
});

async function runBaselineSequence(cwd: string): Promise<string> {
  process.chdir(cwd);
  rmSync(join(cwd, '.terrarium'), { recursive: true, force: true });

  await main(['node', 'terrarium', 'up', 'fintech', '--seed', '42']);
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
    '25000',
  ]);
  await main(['node', 'terrarium', 'advance', '6h']);
  await main(['node', 'terrarium', 'replay']);

  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('No persisted world after sequence');
  return persisted.meta.state_hash;
}

describe('baseline determinism', () => {
  it('produces identical state_hash across three clean runs', async () => {
    const base = mkdtempSync(join(tmpdir(), 'terrarium-det-'));
    const hashes: string[] = [];

    for (let i = 0; i < 3; i++) {
      const cwd = mkdtempSync(join(base, `run-${i}-`));
      hashes.push(await runBaselineSequence(cwd));
    }

    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[0]);

    rmSync(base, { recursive: true, force: true });
  });
});