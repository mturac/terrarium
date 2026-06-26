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

  it('honors Stripe Idempotency-Key header on transfer create', async () => {
    gateway = await createGateway({ cwd, port: 0 });
    const payload = {
      amount: 5000,
      currency: 'usd',
      source: 'acct_0001',
      destination: 'acct_0002',
    };
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'stripe-header-dup',
    };

    const first = await fetch(`${gateway.url}/v1/transfers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const second = await fetch(`${gateway.url}/v1/transfers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(b.id).toBe(a.id);

    const after = loadPersistedWorld(cwd)!;
    const transfers = (after.vertical_state as { transfers: { id: string }[] }).transfers;
    expect(transfers.filter((t) => t.id === a.id)).toHaveLength(1);
  });

  it('GET /v1/transfers/:id retrieves created transfer without mutating state', async () => {
    gateway = await createGateway({ cwd, port: 0 });
    const create = await fetch(`${gateway.url}/v1/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 25000,
        currency: 'usd',
        source: 'acct_0001',
        destination: 'acct_0002',
      }),
    });
    const created = (await create.json()) as { id: string; state_hash: string };
    const hashAfterCreate = loadPersistedWorld(cwd)!.meta.state_hash;

    const get = await fetch(`${gateway.url}/v1/transfers/${created.id}`);
    expect(get.status).toBe(200);
    const retrieved = (await get.json()) as { id: string; state_hash: string; amount: number };
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.amount).toBe(25000);
    expect(retrieved.state_hash).toBe(hashAfterCreate);

    expect(loadPersistedWorld(cwd)!.meta.state_hash).toBe(hashAfterCreate);
  });

  it('GET /v1/openapi.yaml serves gateway spec', async () => {
    gateway = await createGateway({ cwd, port: 0 });
    const res = await fetch(`${gateway.url}/v1/openapi.yaml`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('openapi: 3.1.0');
    expect(text).toContain('/v1/transfers/{id}');
  });

  it('GET /v1/transfers lists transfers without mutating state', async () => {
    gateway = await createGateway({ cwd, port: 0 });
    const hashBefore = loadPersistedWorld(cwd)!.meta.state_hash;

    const create = await fetch(`${gateway.url}/v1/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 12000,
        currency: 'usd',
        source: 'acct_0001',
        destination: 'acct_0002',
      }),
    });
    const created = (await create.json()) as { id: string };
    const hashAfterCreate = loadPersistedWorld(cwd)!.meta.state_hash;

    const list = await fetch(`${gateway.url}/v1/transfers`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      object: string;
      data: { id: string }[];
      has_more: boolean;
    };
    expect(body.object).toBe('list');
    expect(body.has_more).toBe(false);
    expect(body.data.some((t) => t.id === created.id)).toBe(true);
    expect(loadPersistedWorld(cwd)!.meta.state_hash).toBe(hashAfterCreate);
    expect(hashAfterCreate).not.toBe(hashBefore);
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