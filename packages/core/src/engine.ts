import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fallbackScenarioSpec } from './scenario.js';
import { DeterministicClock } from './clock.js';
import { EventLog } from './event-log.js';
import { canonicalJson, sha256 } from './hash.js';
import type {
  EventEnvelope,
  ExportedWorld,
  RunningWorld,
  ScenarioSpec,
  Vertical,
  VerticalContext,
  WorldMeta,
} from './types.js';

const STATE_DIR = '.terrarium';

export interface UpOptions {
  vertical: Vertical;
  scenario: ScenarioSpec;
  scenarioName: string;
  cwd?: string;
}

export function up(options: UpOptions): RunningWorld {
  const cwd = options.cwd ?? process.cwd();
  const worldCwd = cwd;
  const run_id = randomUUID();
  const clock = new DeterministicClock(options.scenario.seed);
  const eventLog = new EventLog();

  const ctx: VerticalContext = {
    seed: options.scenario.seed,
    scenario: options.scenario,
    clock,
    cwd: worldCwd,
    emit: (type, payload) => eventLog.append(type, clock.now(), payload),
  };

  options.vertical.bootstrap(ctx);

  const state = buildExportState(options.vertical, clock, eventLog, options.scenario, {
    run_id,
    vertical: options.vertical.name,
    seed: options.scenario.seed,
    scenario: options.scenarioName,
    started_at: clock.now(),
    state_hash: '',
  });

  state.meta.state_hash = computeStateHash(state);

  persistWorld(cwd, state);

  return {
    meta: state.meta,
    vertical: options.vertical,
    clock,
    eventLog,
    exportState: () =>
      buildExportState(options.vertical, clock, eventLog, options.scenario, state.meta),
  };
}

export function advance(world: RunningWorld, duration: string, cwd?: string): WorldMeta {
  world.clock.advance(duration);
  const state = world.exportState();
  state.meta.state_hash = computeStateHash(state);
  persistWorld(cwd ?? process.cwd(), state);
  return state.meta;
}

export function inject(
  world: RunningWorld,
  action: string,
  args: Record<string, unknown>,
  cwd?: string,
): EventEnvelope[] {
  const worldCwd = cwd ?? process.cwd();
  const persisted = loadPersistedWorld(worldCwd);
  const scenario = persisted?.scenario_spec ?? defaultScenarioFromMeta(world);
  const ctx: VerticalContext = {
    seed: world.meta.seed,
    scenario,
    clock: world.clock,
    cwd: worldCwd,
    emit: (type, payload) => world.eventLog.append(type, world.clock.now(), payload),
  };
  const envelopes = world.vertical.inject(action, args, ctx);
  const state = world.exportState();
  state.meta.state_hash = computeStateHash(state);
  persistWorld(worldCwd, state);
  return envelopes;
}

export function replayFromExport(
  vertical: Vertical,
  exported: ExportedWorld,
): { world: RunningWorld; matches: boolean } {
  const clock = new DeterministicClock(exported.meta.seed);
  clock.restore(exported.clock_tick);
  const eventLog = new EventLog();
  eventLog.load(exported.events);

  if (!eventLog.verifyChain()) {
    throw new Error('Event log chain verification failed');
  }

  vertical.restoreState(exported.vertical_state);

  const world: RunningWorld = {
    meta: { ...exported.meta },
    vertical,
    clock,
    eventLog,
    exportState: () =>
      buildExportState(vertical, clock, eventLog, exported.scenario_spec, exported.meta),
  };

  const rebuilt = world.exportState();
  const matches = rebuilt.meta.state_hash === exported.meta.state_hash;

  return { world, matches };
}

function buildExportState(
  vertical: Vertical,
  clock: DeterministicClock,
  eventLog: EventLog,
  scenario_spec: ScenarioSpec,
  meta: WorldMeta,
): ExportedWorld {
  const snapshot: ExportedWorld = {
    meta: { ...meta, state_hash: '' },
    clock_tick: clock.getTick(),
    events: eventLog.export(),
    vertical_state: vertical.getState(),
    scenario_spec,
  };
  snapshot.meta.state_hash = computeStateHash(snapshot);
  return snapshot;
}

function computeStateHash(state: ExportedWorld): string {
  const body = {
    clock_tick: state.clock_tick,
    vertical_state: state.vertical_state,
    event_count: state.events.length,
    last_event_hash: state.events.at(-1)?.hash ?? null,
  };
  return sha256(canonicalJson(body));
}

function persistWorld(cwd: string, state: ExportedWorld): void {
  const dir = join(cwd, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'world.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, 'status.json'), JSON.stringify(state.meta, null, 2));
}

function defaultScenarioFromMeta(world: RunningWorld): ScenarioSpec {
  return fallbackScenarioSpec(world.meta.vertical, world.meta.seed);
}

export function loadPersistedWorld(cwd: string): ExportedWorld | null {
  try {
    const raw = readFileSync(join(cwd, STATE_DIR, 'world.json'), 'utf8');
    return JSON.parse(raw) as ExportedWorld;
  } catch {
    return null;
  }
}