import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EventEnvelope, Vertical, VerticalContext } from './types.js';
import { defaultFintechBaseline } from './scenario.js';
import { advance, inject, up } from './engine.js';

class MockVertical implements Vertical {
  readonly name = 'mock';
  private counter = 0;

  bootstrap(ctx: VerticalContext): void {
    ctx.emit('world.bootstrapped', { seed: ctx.seed });
  }

  inject(action: string, args: Record<string, unknown>, ctx: VerticalContext): EventEnvelope[] {
    this.counter += 1;
    return [ctx.emit('mock.inject', { action, args, n: this.counter })];
  }

  getState(): Record<string, unknown> {
    return { counter: this.counter };
  }

  restoreState(state: Record<string, unknown>): void {
    this.counter = Number(state.counter ?? 0);
  }
}

describe('Terrarium engine', () => {
  it('produces identical state hash for same seed', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'terrarium-'));
    const scenario = { ...defaultFintechBaseline(), vertical: 'mock', population: 5 };

    const worldA = up({ vertical: new MockVertical(), scenario, scenarioName: 'test', cwd });
    const hashA = worldA.meta.state_hash;

    rmSync(join(cwd, '.terrarium'), { recursive: true, force: true });

    const worldB = up({ vertical: new MockVertical(), scenario, scenarioName: 'test', cwd });
    expect(worldA.meta.seed).toBe(worldB.meta.seed);
    expect(hashA).toBe(worldB.meta.state_hash);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('inject and advance mutate persisted state', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'terrarium-'));
    const world = up({
      vertical: new MockVertical(),
      scenario: { ...defaultFintechBaseline(), vertical: 'mock' },
      scenarioName: 'test',
      cwd,
    });

    inject(world, 'ping', { x: 1 });
    const state = world.vertical.getState();
    expect(state.counter).toBe(1);

    advance(world, '1h');
    expect(world.clock.getTick()).toBe(3600);
    rmSync(cwd, { recursive: true, force: true });
  });
});