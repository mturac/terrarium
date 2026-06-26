#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function runCurl(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('curl', args, { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const GATEWAY_ENTRY = join(ROOT, 'packages/gateway/dist/index.js');
const cwd = mkdtempSync(join(tmpdir(), 'terrarium-http-'));

const up = spawnSync('node', [CLI, 'up', 'fintech', '--seed', '42'], { cwd, encoding: 'utf8' });
if (up.status !== 0) {
  console.error(up.stderr || up.stdout);
  process.exit(1);
}

const before = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));

// CLI inject for cross-path parity (inject-only, no advance)
const cliInject = spawnSync(
  'node',
  [
    CLI,
    'inject',
    'transfer',
    '--from',
    'acct_0001',
    '--to',
    'acct_0002',
    '--amount',
    '25000',
  ],
  { cwd, encoding: 'utf8' },
);
if (cliInject.status !== 0) {
  console.error(cliInject.stderr || cliInject.stdout);
  process.exit(1);
}
const cliAfter = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
rmSync(join(cwd, '.terrarium'), { recursive: true, force: true });

const up2 = spawnSync('node', [CLI, 'up', 'fintech', '--seed', '42'], { cwd, encoding: 'utf8' });
if (up2.status !== 0) process.exit(1);

const { createGateway } = await import(GATEWAY_ENTRY);
const gw = await createGateway({ cwd, port: 0 });
const payload = JSON.stringify({
  amount: 25000,
  currency: 'usd',
  source: 'acct_0001',
  destination: 'acct_0002',
});

// Async curl: spawnSync would block the event loop and stall the in-process gateway.
const curl = await runCurl([
  '-sS',
  '-w',
  '\nHTTP_CODE:%{http_code}\n',
  '-X',
  'POST',
  `${gw.url}/v1/transfers`,
  '-H',
  'Content-Type: application/json',
  '-d',
  payload,
]);

console.log('=== curl stdout ===');
console.log(curl.stdout);
if (curl.code !== 0) {
  console.error('curl failed', curl.stderr);
  process.exit(1);
}

const after = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
const webhookLines = readFileSync(join(cwd, '.terrarium', 'webhooks.jsonl'), 'utf8')
  .trim()
  .split('\n').length;

console.log('BEFORE_HASH', before.meta.state_hash);
console.log('CLI_INJECT_HASH', cliAfter.meta.state_hash);
console.log('HTTP_AFTER_HASH', after.meta.state_hash);
console.log('WEBHOOK_LINES', webhookLines);
console.log('PARITY_OK', after.meta.state_hash === cliAfter.meta.state_hash);

gw.server.closeAllConnections?.();
await gw.close();
rmSync(cwd, { recursive: true, force: true });

if (after.meta.state_hash !== cliAfter.meta.state_hash) {
  process.exit(1);
}