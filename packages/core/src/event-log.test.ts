import { describe, expect, it } from 'vitest';
import { DeterministicClock } from './clock.js';
import { EventLog } from './event-log.js';

describe('EventLog', () => {
  it('builds verifiable hash chain', () => {
    const clock = new DeterministicClock(1);
    const log = new EventLog();
    log.append('test.a', clock.now(), { a: 1 });
    log.append('test.b', clock.now(), { b: 2 });
    expect(log.verifyChain()).toBe(true);
    expect(log.all()).toHaveLength(2);
    expect(log.all()[1]?.prev_hash).toBe(log.all()[0]?.hash);
  });
});
