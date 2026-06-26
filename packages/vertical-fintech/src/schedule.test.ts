import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { up, loadPersistedWorld, defaultFintechBaseline } from '@terrarium/core';
import { createFintechVertical } from './fintech-vertical.js';

describe('up() schedule execution', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'terrarium-schedule-'));
  });

  it('runs empty schedule without altering baseline behaviour', () => {
    const scenario = defaultFintechBaseline();
    const world = up({
      vertical: createFintechVertical(),
      scenario,
      scenarioName: 'fintech/baseline',
      cwd,
    });
    const persisted = loadPersistedWorld(cwd);
    expect(persisted?.meta.state_hash).toBe(world.meta.state_hash);
    // Empty schedule => only bootstrap events (50 account.created) — schedule itself emits nothing.
    expect(persisted?.events.length).toBe(50);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('executes a non-empty schedule and persists new state_hash', () => {
    const scenario = {
      ...defaultFintechBaseline(),
      schedule: [
        {
          at: '0s',
          inject: 'transfer',
          args: { from: 'acct_0001', to: 'acct_0002', amount: 1000 },
        },
        {
          at: '+1h',
          inject: 'transfer',
          args: { from: 'acct_0002', to: 'acct_0001', amount: 500 },
        },
      ],
    };
    const world = up({
      vertical: createFintechVertical(),
      scenario,
      scenarioName: 'fintech/test-schedule',
      cwd,
    });
    const persisted = loadPersistedWorld(cwd);
    expect(persisted?.meta.state_hash).toBe(world.meta.state_hash);
    // Two transfers => at least 2 events emitted
    expect(persisted && persisted.events.length).toBeGreaterThanOrEqual(2);
    // Clock should have advanced past 1h
    expect(world.clock.getTick()).toBeGreaterThanOrEqual(3600);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is deterministic across runs with same seed + schedule', () => {
    const scenario = {
      ...defaultFintechBaseline(),
      seed: 7,
      schedule: [
        { at: '0s', inject: 'transfer', args: { from: 'acct_0001', to: 'acct_0002', amount: 250 } },
        {
          at: '+30m',
          inject: 'transfer',
          args: { from: 'acct_0003', to: 'acct_0004', amount: 750 },
        },
      ],
    };

    const cwds = [0, 1, 2].map(() => mkdtempSync(join(tmpdir(), 'terrarium-schedule-det-')));
    const hashes: string[] = [];
    for (const dir of cwds) {
      const world = up({
        vertical: createFintechVertical(),
        scenario,
        scenarioName: 'fintech/test-det',
        cwd: dir,
      });
      hashes.push(world.meta.state_hash);
      rmSync(dir, { recursive: true, force: true });
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[1]).toBe(hashes[2]);
  });
});
