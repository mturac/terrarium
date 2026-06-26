#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

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

function waitForServeReady(proc, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for terrarium serve'));
    }, timeoutMs);

    const onData = (chunk) => {
      buf += chunk;
      const match = buf.match(/gateway listening on (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve({ url: match[1], log: buf });
      }
    };

    proc.stdout.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (!buf.includes('gateway listening on')) {
        clearTimeout(timer);
        reject(new Error(`serve exited early (${code}): ${buf}`));
      }
    });
  });
}

function stopServe(proc) {
  return new Promise((resolve) => {
    if (proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

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

const port = await getFreePort();
console.log('=== terrarium serve launch ===');
console.log(`command: node ${CLI} serve --port ${port}`);

const serve = spawn('node', [CLI, 'serve', '--port', String(port)], {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
});

let serveLog = '';
serve.stderr.on('data', (chunk) => {
  serveLog += chunk;
});

const { url: baseUrl, log: serveStdout } = await waitForServeReady(serve);
console.log(serveStdout.trim());
console.log('SERVE_URL', baseUrl);

const payload = JSON.stringify({
  amount: 25000,
  currency: 'usd',
  source: 'acct_0001',
  destination: 'acct_0002',
});

// Async curl: spawnSync blocks the event loop and stalls the in-process gateway.
const curl = await runCurl([
  '-sS',
  '-w',
  '\nHTTP_CODE:%{http_code}\n',
  '-X',
  'POST',
  `${baseUrl}/v1/transfers`,
  '-H',
  'Content-Type: application/json',
  '-d',
  payload,
]);

console.log('=== curl stdout ===');
console.log(curl.stdout);
if (curl.code !== 0) {
  console.error('curl failed', curl.stderr);
  await stopServe(serve);
  process.exit(1);
}

const statusCurl = await runCurl(['-sS', `${baseUrl}/v1/status`]);
console.log('=== status curl ===');
console.log(statusCurl.stdout);

const created = JSON.parse(curl.stdout.split('\nHTTP_CODE')[0]);
const retrieveCurl = await runCurl(['-sS', '-w', '\nHTTP_CODE:%{http_code}\n', `${baseUrl}/v1/transfers/${created.id}`]);
console.log('=== retrieve curl ===');
console.log(retrieveCurl.stdout);
const retrieved = JSON.parse(retrieveCurl.stdout.split('\nHTTP_CODE')[0]);
console.log('RETRIEVE_OK', retrieved.id === created.id && retrieved.state_hash === created.state_hash);

const openapiCurl = await runCurl(['-sS', `${baseUrl}/v1/openapi.yaml`]);
console.log('OPENAPI_OK', openapiCurl.stdout.includes('openapi: 3.1.0'));

const after = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
const webhookLines = readFileSync(join(cwd, '.terrarium', 'webhooks.jsonl'), 'utf8')
  .trim()
  .split('\n').length;

console.log('BEFORE_HASH', before.meta.state_hash);
console.log('CLI_INJECT_HASH', cliAfter.meta.state_hash);
console.log('HTTP_AFTER_HASH', after.meta.state_hash);
console.log('WEBHOOK_LINES', webhookLines);
console.log('PARITY_OK', after.meta.state_hash === cliAfter.meta.state_hash);
console.log('STATE_CHANGED', after.meta.state_hash !== before.meta.state_hash);

await stopServe(serve);
if (serveLog) console.log('serve stderr:', serveLog.trim());

rmSync(cwd, { recursive: true, force: true });

if (after.meta.state_hash !== cliAfter.meta.state_hash) {
  process.exit(1);
}