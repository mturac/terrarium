import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPersistedWorld, loadScenarioFromFile, up } from '@terrarium/core';
import { createFintechVertical } from '@terrarium/vertical-fintech';

const CLI = resolve(import.meta.dirname, '../dist/bin.js');

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolvePort(port)));
    });
    server.on('error', reject);
  });
}

function waitForServe(proc: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('serve timeout')), 10_000);
    proc.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/gateway listening on (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveReady(match[1]);
      }
    });
    proc.on('exit', (code) => {
      if (!buf.includes('gateway listening on')) {
        clearTimeout(timer);
        reject(new Error(`serve exited (${code}): ${buf}`));
      }
    });
  });
}

function stopServe(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveStop) => {
    if (proc.exitCode !== null) {
      resolveStop();
      return;
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolveStop();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    proc.kill('SIGTERM');
  });
}

let cwd: string;
let originalCwd: string;
let serveProc: ChildProcessWithoutNullStreams | null = null;

beforeEach(() => {
  originalCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'terrarium-serve-cli-'));
  process.chdir(cwd);
  const scenario = loadScenarioFromFile(
    resolve(import.meta.dirname, '../../../scenarios/fintech/baseline.yaml'),
  );
  scenario.seed = 42;
  up({
    vertical: createFintechVertical(),
    scenario,
    scenarioName: 'fintech/baseline',
    cwd,
  });
});

afterEach(async () => {
  if (serveProc) {
    await stopServe(serveProc);
    serveProc = null;
  }
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('terrarium serve', () => {
  it('launches gateway bin and accepts transfer POST', async () => {
    const port = await getFreePort();
    serveProc = spawn('node', [CLI, 'serve', '--port', String(port)], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const baseUrl = await waitForServe(serveProc);
    expect(baseUrl).toBe(`http://127.0.0.1:${port}`);

    const health = await fetch(`${baseUrl}/v1/health`);
    expect(health.status).toBe(200);

    const before = loadPersistedWorld(cwd)!;
    const res = await fetch(`${baseUrl}/v1/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 25000,
        currency: 'usd',
        source: 'acct_0001',
        destination: 'acct_0002',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { state_hash: string; status: string };
    expect(body.status).toBe('settled');

    const after = loadPersistedWorld(cwd)!;
    expect(after.meta.state_hash).toBe(body.state_hash);
    expect(after.meta.state_hash).not.toBe(before.meta.state_hash);
    expect(readFileSync(join(cwd, '.terrarium', 'webhooks.jsonl'), 'utf8').trim().length).toBeGreaterThan(0);
  });
});