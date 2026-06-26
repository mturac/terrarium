import { describe, expect, it } from 'vitest';
import { DeterministicClock } from '@terrarium/core';
import type { ScenarioSpec, VerticalContext } from '@terrarium/core';
import { createFintechVertical } from './fintech-vertical.js';

const scenario: ScenarioSpec = {
  vertical: 'fintech',
  seed: 42,
  population: 10,
  initial_balance_cents: 100_000,
  currency: 'USD',
  schedule: [],
};

function makeCtx(seed: number): VerticalContext {
  const clock = new DeterministicClock(seed);
  const events: ReturnType<VerticalContext['emit']>[] = [];
  return {
    seed,
    scenario,
    clock,
    cwd: process.cwd(),
    emit: (type, payload) => {
      const envelope = {
        seq: events.length,
        type,
        at: clock.now(),
        payload,
        prev_hash: '0',
        hash: String(events.length),
      };
      events.push(envelope);
      return envelope;
    },
  };
}

describe('FintechVertical', () => {
  it('bootstraps population', () => {
    const v = createFintechVertical();
    v.bootstrap(makeCtx(42));
    const state = v.getState() as { accounts: unknown[]; users: unknown[] };
    expect(state.users).toHaveLength(10);
    expect(state.accounts).toHaveLength(10);
  });

  it('enforces idempotency', () => {
    const v = createFintechVertical();
    const ctx = makeCtx(42);
    v.bootstrap(ctx);
    v.inject('transfer', {
      from: 'acct_0001',
      to: 'acct_0002',
      amount: 1000,
      idempotency_key: 'dup',
    }, ctx);
    v.inject('transfer', {
      from: 'acct_0001',
      to: 'acct_0002',
      amount: 1000,
      idempotency_key: 'dup',
    }, ctx);
    const state = v.getState() as { transfers: unknown[] };
    expect(state.transfers).toHaveLength(1);
  });
});