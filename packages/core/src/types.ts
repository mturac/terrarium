export interface VirtualTimestamp {
  iso: string;
  tick: number;
}

export interface EventEnvelope {
  seq: number;
  type: string;
  at: VirtualTimestamp;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface ScenarioSpec {
  vertical: string;
  seed: number;
  population: number;
  initial_balance_cents?: number;
  currency?: string;
  webhook_sink?: string;
  schedule: ScheduledInjection[];
}

export interface ScheduledInjection {
  at: string;
  inject: string;
  args: Record<string, unknown>;
}

export interface WorldMeta {
  run_id: string;
  vertical: string;
  seed: number;
  scenario: string;
  started_at: VirtualTimestamp;
  state_hash: string;
}

export interface VerticalContext {
  seed: number;
  scenario: ScenarioSpec;
  clock: import('./clock.js').DeterministicClock;
  cwd: string;
  emit: (type: string, payload: Record<string, unknown>) => EventEnvelope;
}

export interface Vertical {
  readonly name: string;
  bootstrap(ctx: VerticalContext): void;
  inject(action: string, args: Record<string, unknown>, ctx: VerticalContext): EventEnvelope[];
  getState(): Record<string, unknown>;
  restoreState(state: Record<string, unknown>): void;
}

export interface ExportedWorld {
  meta: WorldMeta;
  clock_tick: number;
  events: EventEnvelope[];
  vertical_state: Record<string, unknown>;
  scenario_spec: ScenarioSpec;
}

export interface RunningWorld {
  meta: WorldMeta;
  vertical: Vertical;
  clock: import('./clock.js').DeterministicClock;
  eventLog: import('./event-log.js').EventLog;
  exportState(): ExportedWorld;
}
