#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../packages/gateway/dist/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const cwd = mkdtempSync(join(tmpdir(), 'terrarium-http-'));

const up = spawnSync('node', [CLI, 'up', 'fintech', '--seed', '42'], { cwd, encoding: 'utf8' });
if (up.status !== 0) {
  console.error(up.stderr || up.stdout);
  process.exit(1);
}

const before = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));

const gw = await createGateway({ cwd, port: 0 });
const res = await fetch(`${gw.url}/v1/transfers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 25000,
    currency: 'usd',
    source: 'acct_0001',
    destination: 'acct_0002',
    idempotency_key: 'http-verify',
  }),
});

const body = await res.json();
const after = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
const webhookLines = readFileSync(join(cwd, '.terrarium', 'webhooks.jsonl'), 'utf8')
  .trim()
  .split('\n').length;

console.log('HTTP_STATUS', res.status);
console.log('HTTP_BODY', JSON.stringify(body));
console.log('BEFORE_HASH', before.meta.state_hash);
console.log('AFTER_HASH', after.meta.state_hash);
console.log('WEBHOOK_LINES', webhookLines);
console.log('TRANSFER_STATUS', body.status);

await gw.close();
rmSync(cwd, { recursive: true, force: true });

if (res.status !== 201 || body.status !== 'settled' || after.meta.state_hash === before.meta.state_hash) {
  process.exit(1);
}