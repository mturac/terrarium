import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPersistedWorld, loadScenarioFromFile, replayFromExport, up } from '@terrarium/core';
import { createFintechVertical } from '@terrarium/vertical-fintech';
import { createGateway } from './server.js';

let cwd: string;
let gateway: Awaited<ReturnType<typeof createGateway>> | null = null;

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'terrarium-gw-'));
  const scenarioPath = resolve(import.meta.dirname, '../../../scenarios/fintech/baseline.yaml');
  process.chdir(cwd);
  const scenario = loadScenarioFromFile(scenarioPath);
  up({
    vertical: createFintechVertical(),
    scenario,
    scenarioName: 'fintech/baseline',
    cwd,
  });
});

afterEach(async () => {
  if (gateway) {
    await gateway.close();
    gateway = null;
  }
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('HTTP gateway', () => {
  it('POST /v1/transfers drives same engine as CLI inject', async () => {
    const before = loadPersistedWorld(cwd)!;
    const webhooksBefore = (before.vertical_state as { webhooks: unknown[] }).webhooks.length;

    gateway = await createGateway({ cwd, port: 0 });
    const res = await fetch(`${gateway.url}/v1/transfers`, {
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
    const body = (await res.json()) as { status: string; state_hash: string; id: string };
    expect(body.status).toBe('settled');
    expect(body.id).toMatch(/^txn_/);

    const after = loadPersistedWorld(cwd)!;
    expect(after.meta.state_hash).toBe(body.state_hash);
    expect(after.meta.state_hash).not.toBe(before.meta.state_hash);
    const webhooksAfter = (after.vertical_state as { webhooks: unknown[] }).webhooks.length;
    expect(webhooksAfter).toBeGreaterThan(webhooksBefore);
    expect(countWebhookLines(cwd)).toBeGreaterThanOrEqual(webhooksAfter);

    const vertical = createFintechVertical();
    const { matches } = replayFromExport(vertical, after);
    expect(matches).toBe(true);

    const statusRes = await fetch(`${gateway.url}/v1/status`);
    const status = (await statusRes.json()) as { state_hash: string };
    expect(status.state_hash).toBe(after.meta.state_hash);
  });
});

function countWebhookLines(cwd: string): number {
  try {
    const raw = readFileSync(join(cwd, '.terrarium', 'webhooks.jsonl'), 'utf8');
    return raw.trim() ? raw.trim().split('\n').length : 0;
  } catch {
    return 0;
  }
}