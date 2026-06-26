#!/usr/bin/env node
/**
 * CI determinism gate for scheduled scenarios:
 * `terrarium scenario install fintech/chargeback-storm` then
 * `terrarium up fintech --scenario installed:fintech/chargeback-storm`
 * across 3 clean dirs must produce identical state_hash.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');

function run(args, cwd) {
  const env = { ...process.env, FORCE_COLOR: '0' };
  const r = spawnSync('node', [CLI, ...args], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`Command failed: terrarium ${args.join(' ')}`);
  }
}

function hashOf(cwd) {
  return JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8')).meta.state_hash;
}

const hashes = [];
const base = mkdtempSync(join(tmpdir(), 'terrarium-schedule-gate-'));

for (let i = 0; i < 3; i++) {
  const cwd = mkdtempSync(join(base, `run-${i}-`));
  run(['scenario', 'install', 'fintech/chargeback-storm'], cwd);
  run(['up', 'fintech', '--scenario', 'installed:fintech/chargeback-storm'], cwd);
  run(['replay'], cwd);
  hashes.push(hashOf(cwd));
  console.log(`run ${i + 1}: ${hashes[i]}`);
}

rmSync(base, { recursive: true, force: true });

if (hashes[0] !== hashes[1] || hashes[1] !== hashes[2]) {
  console.error('SCHEDULE DETERMINISM GATE FAILED');
  console.error(hashes);
  process.exit(1);
}

console.log(`SCHEDULE DETERMINISM GATE OK: ${hashes[0]}`);