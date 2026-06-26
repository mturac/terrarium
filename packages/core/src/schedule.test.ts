import { describe, expect, it } from 'vitest';
import { parseScheduleOffset, sortSchedule } from './schedule.js';

describe('parseScheduleOffset', () => {
  it('parses leading + offsets', () => {
    expect(parseScheduleOffset('+2h')).toBe(2 * 3_600_000);
    expect(parseScheduleOffset('+30m')).toBe(30 * 60_000);
    expect(parseScheduleOffset('+500ms')).toBe(500);
  });

  it('parses offsets without leading +', () => {
    expect(parseScheduleOffset('0s')).toBe(0);
    expect(parseScheduleOffset('1h')).toBe(3_600_000);
    expect(parseScheduleOffset('2d')).toBe(2 * 86_400_000);
  });

  it('trims whitespace', () => {
    expect(parseScheduleOffset('  +1h  ')).toBe(3_600_000);
  });

  it('rejects empty input', () => {
    expect(() => parseScheduleOffset('')).toThrow();
    expect(() => parseScheduleOffset('   ')).toThrow();
    expect(() => parseScheduleOffset('+')).toThrow();
  });

  it('rejects garbage', () => {
    expect(() => parseScheduleOffset('+soon')).toThrow();
    expect(() => parseScheduleOffset('two hours')).toThrow();
  });
});

describe('sortSchedule', () => {
  it('sorts by ascending offset (ms)', () => {
    const sorted = sortSchedule([
      { at: '+2h', inject: 'b', args: {} },
      { at: '+0s', inject: 'a', args: {} },
      { at: '+30m', inject: 'c', args: {} },
    ]);
    expect(sorted.map((e) => e.inject)).toEqual(['a', 'c', 'b']);
  });

  it('preserves input order on ties (stable)', () => {
    const sorted = sortSchedule([
      { at: '+1h', inject: 'first', args: {} },
      { at: '+1h', inject: 'second', args: {} },
      { at: '0s', inject: 't0-a', args: {} },
      { at: '0s', inject: 't0-b', args: {} },
    ]);
    expect(sorted.map((e) => e.inject)).toEqual(['t0-a', 't0-b', 'first', 'second']);
  });
});
