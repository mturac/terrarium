import { parseDuration } from './clock.js';

/**
 * Parse a schedule offset such as "+2h", "+30m", "0s", "1h".
 *
 * Accepts an optional leading `+`. The unit grammar matches `parseDuration`
 * in clock.ts (ms / s / m / h / d) so the runner can round-trip through
 * `DeterministicClock.advance`.
 */
export function parseScheduleOffset(input: string): number {
  const trimmed = input.trim();
  const normalised = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  if (!normalised) {
    throw new Error(`Invalid schedule offset: "${input}"`);
  }
  return parseDuration(normalised);
}

export interface ScheduledInjection {
  at: string;
  inject: string;
  args: Record<string, unknown>;
}

/**
 * Sort a schedule by ascending offset (ms). Stable — preserves input order
 * for ties so deterministic seed-anchored behaviour is preserved.
 */
export function sortSchedule(schedule: readonly ScheduledInjection[]): ScheduledInjection[] {
  return [...schedule]
    .map((entry, index) => ({ entry, index, offset: parseScheduleOffset(entry.at) }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index)
    .map((row) => row.entry);
}
