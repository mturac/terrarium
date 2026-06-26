import { DeterministicClock } from './clock.js';
import { EventLog } from './event-log.js';
import { canonicalJson, sha256 } from './hash.js';
import type { ExportedWorld, RunningWorld, ScenarioSpec, Vertical, WorldMeta } from './types.js';
import { loadPersistedWorld } from './engine.js';
import { fallbackScenarioSpec } from './scenario.js';

export function loadRunningWorld(cwd: string, vertical: Vertical): RunningWorld {
  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('No running world');

  vertical.restoreState(persisted.vertical_state);

  const clock = new DeterministicClock(persisted.meta.seed);
  clock.restore(persisted.clock_tick);
  const eventLog = new EventLog();
  eventLog.load(persisted.events);

  const meta = { ...persisted.meta };
  const scenario_spec = persisted.scenario_spec ?? fallbackScenarioSpec(meta.vertical, meta.seed);

  return {
    meta,
    vertical,
    clock,
    eventLog,
    exportState: () => rebuildExport(vertical, clock, eventLog, scenario_spec, meta),
  };
}

export function rebuildExport(
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
  const body = {
    clock_tick: snapshot.clock_tick,
    vertical_state: snapshot.vertical_state,
    event_count: snapshot.events.length,
    last_event_hash: snapshot.events.at(-1)?.hash ?? null,
  };
  snapshot.meta.state_hash = sha256(canonicalJson(body));
  return snapshot;
}