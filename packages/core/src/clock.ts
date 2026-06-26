import type { VirtualTimestamp } from './types.js';

const EPOCH = Date.parse('2024-01-15T00:00:00.000Z');

export class DeterministicClock {
  private tick = 0;

  constructor(private readonly seed: number) {}

  now(): VirtualTimestamp {
    return {
      iso: new Date(EPOCH + this.tick * 1000).toISOString(),
      tick: this.tick,
    };
  }

  advance(duration: string): VirtualTimestamp {
    const ms = parseDuration(duration);
    this.tick += Math.floor(ms / 1000);
    return this.now();
  }

  restore(tick: number): void {
    this.tick = tick;
  }

  getTick(): number {
    return this.tick;
  }

  /** Mix seed into scheduled jitter without breaking determinism. */
  deriveNonce(label: string, index: number): number {
    let h = this.seed ^ index;
    for (const ch of label) {
      h = Math.imul(h ^ ch.charCodeAt(0), 0x9e3779b1);
    }
    return (h >>> 0) % 10_000;
  }
}

export function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${input}. Use e.g. 1h, 30m, 500ms`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (multipliers[unit] ?? 0);
}
