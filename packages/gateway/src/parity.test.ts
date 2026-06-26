import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inject,
  loadPersistedWorld,
  loadRunningWorld,
  loadScenarioFromFile,
  up,
} from '@terrarium/core';
import { createFintechVertical } from '@terrarium/vertical-fintech';
import { createGateway } from './server.js';

const TRANSFER = {
  amount: 25000,
  currency: 'usd',
  source: 'acct_0001',
  destination: 'acct_0002',
};

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe('CLI vs HTTP parity', () => {
  it('post-inject state_hash matches for identical up+transfer', async () => {
    const scenarioPath = resolve(import.meta.dirname, '../../../scenarios/fintech/baseline.yaml');
    const scenario = loadScenarioFromFile(scenarioPath);
    scenario.seed = 42;

    const cliCwd = mkdtempSync(join(tmpdir(), 'terrarium-parity-cli-'));
    process.chdir(cliCwd);
    const verticalCli = createFintechVertical();
    const worldCli = up({
      vertical: verticalCli,
      scenario,
      scenarioName: 'fintech/baseline',
      cwd: cliCwd,
    });
    inject(
      worldCli,
      'transfer',
      { from: TRANSFER.source, to: TRANSFER.destination, amount: TRANSFER.amount, currency: 'USD' },
      cliCwd,
    );
    const cliHash = loadPersistedWorld(cliCwd)!.meta.state_hash;

    const httpCwd = mkdtempSync(join(tmpdir(), 'terrarium-parity-http-'));
    const verticalHttp = createFintechVertical();
    up({
      vertical: verticalHttp,
      scenario,
      scenarioName: 'fintech/baseline',
      cwd: httpCwd,
    });

    const gw = await createGateway({ cwd: httpCwd, port: 0 });
    const res = await fetch(`${gw.url}/v1/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TRANSFER),
    });
    expect(res.status).toBe(201);
    const httpHash = loadPersistedWorld(httpCwd)!.meta.state_hash;
    await gw.close();

    expect(httpHash).toBe(cliHash);

    rmSync(cliCwd, { recursive: true, force: true });
    rmSync(httpCwd, { recursive: true, force: true });
  });

  it('loadRunningWorld uses same fallback scenario_spec as inject path', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'terrarium-parity-spec-'));
    const scenario = loadScenarioFromFile(
      resolve(import.meta.dirname, '../../../scenarios/fintech/baseline.yaml'),
    );
    scenario.seed = 42;
    const vertical = createFintechVertical();
    up({ vertical, scenario, scenarioName: 'fintech/baseline', cwd });

    const raw = readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8');
    const persisted = JSON.parse(raw) as Record<string, unknown>;
    delete persisted.scenario_spec;
    writeFileSync(join(cwd, '.terrarium', 'world.json'), JSON.stringify(persisted));

    const running = loadRunningWorld(cwd, createFintechVertical());
    inject(running, 'transfer', { from: 'acct_0001', to: 'acct_0002', amount: 1000 }, cwd);
    const after = loadPersistedWorld(cwd)!;
    expect(after.scenario_spec.initial_balance_cents).toBe(100_000);
    expect(after.scenario_spec.currency).toBe('USD');

    rmSync(cwd, { recursive: true, force: true });
  });
});
