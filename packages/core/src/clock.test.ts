import { describe, expect, it } from 'vitest';
import { DeterministicClock, parseDuration } from './clock.js';

describe('DeterministicClock', () => {
  it('advances deterministically', () => {
    const a = new DeterministicClock(42);
    const b = new DeterministicClock(42);
    a.advance('1h');
    b.advance('1h');
    expect(a.now().tick).toBe(b.now().tick);
    expect(a.now().iso).toBe(b.now().iso);
  });

  it('parses durations', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('30m')).toBe(1_800_000);
  });
});