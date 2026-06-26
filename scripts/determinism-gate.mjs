#!/usr/bin/env node
/**
 * CI determinism gate: three clean baseline sequences must yield identical state_hash.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');

function runSequence(cwd) {
  const env = { ...process.env, FORCE_COLOR: '0' };
  const steps = [
    [CLI, 'up', 'fintech', '--seed', '42'],
    [CLI, 'inject', 'transfer', '--from', 'acct_0001', '--to', 'acct_0002', '--amount', '25000'],
    [CLI, 'advance', '6h'],
    [CLI, 'replay'],
  ];

  for (const args of steps) {
    const r = spawnSync('node', args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
      throw new Error(`Command failed: node ${args.join(' ')}`);
    }
  }

  const world = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
  return world.meta.state_hash;
}

const hashes = [];
const base = mkdtempSync(join(tmpdir(), 'terrarium-ci-gate-'));

for (let i = 0; i < 3; i++) {
  const cwd = mkdtempSync(join(base, `run-${i}-`));
  hashes.push(runSequence(cwd));
  console.log(`run ${i + 1}: ${hashes[i]}`);
}

rmSync(base, { recursive: true, force: true });

if (hashes[0] !== hashes[1] || hashes[1] !== hashes[2]) {
  console.error('DETERMINISM GATE FAILED');
  console.error(hashes);
  process.exit(1);
}

console.log(`DETERMINISM GATE OK: ${hashes[0]}`);