import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DeterministicClock,
  EventLog,
  advance,
  canonicalJson,
  inject,
  loadPersistedWorld,
  loadScenarioFromFile,
  replayFromExport,
  sha256,
  up,
  type RunningWorld,
} from '@terrarium/core';
import { createFintechVertical } from '@terrarium/vertical-fintech';

export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'up':
      cmdUp(args.slice(1));
      return;
    case 'status':
      cmdStatus();
      return;
    case 'advance':
      cmdAdvance(args[1]);
      return;
    case 'inject':
      cmdInject(args.slice(1));
      return;
    case 'replay':
      cmdReplay(args[1]);
      return;
    case 'down':
      cmdDown();
      return;
    case undefined:
    case 'help':
    case '--help':
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function cmdUp(args: string[]): void {
  const verticalName = args[0];
  if (!verticalName) throw new Error('Usage: terrarium up <vertical> [--scenario path] [--seed N]');

  let scenarioPath: string | null = null;
  let seedOverride: number | null = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      scenarioPath = resolve(args[++i]!);
    } else if (args[i] === '--seed' && args[i + 1]) {
      seedOverride = Number(args[++i]);
    }
  }

  const vertical = resolveVertical(verticalName);
  const scenarioFile =
    scenarioPath ?? resolve(findRepoRoot(), 'scenarios', verticalName, 'baseline.yaml');
  const scenario = loadScenarioFromFile(scenarioFile);
  if (seedOverride !== null) scenario.seed = seedOverride;

  const world = up({
    vertical,
    scenario,
    scenarioName: scenarioPath ?? `${verticalName}/baseline`,
    cwd: process.cwd(),
  });

  console.log('terrarium: world up');
  console.log(`  run_id:    ${world.meta.run_id}`);
  console.log(`  vertical:  ${world.meta.vertical}`);
  console.log(`  seed:      ${world.meta.seed}`);
  console.log(`  scenario:  ${world.meta.scenario}`);
  console.log(`  accounts:  ${countAccounts(world)}`);
  console.log(`  state:     ${world.meta.state_hash.slice(0, 16)}…`);
}

function cmdStatus(): void {
  const persisted = loadPersistedWorld(process.cwd());
  if (!persisted) throw new Error('No running world. Run: terrarium up fintech');

  console.log('terrarium: running');
  console.log(`  run_id:    ${persisted.meta.run_id}`);
  console.log(`  vertical:  ${persisted.meta.vertical}`);
  console.log(`  seed:      ${persisted.meta.seed}`);
  console.log(`  clock:     tick ${persisted.clock_tick}`);
  console.log(`  events:    ${persisted.events.length}`);
  console.log(`  state:     ${persisted.meta.state_hash.slice(0, 16)}…`);
}

function cmdAdvance(duration: string | undefined): void {
  if (!duration) throw new Error('Usage: terrarium advance <duration>  e.g. 1h, 30m');
  const world = loadRunningWorld();
  const meta = advance(world, duration);
  console.log('terrarium: advanced');
  console.log(`  clock:     tick ${world.clock.getTick()}`);
  console.log(`  state:     ${meta.state_hash.slice(0, 16)}…`);
}

function cmdInject(args: string[]): void {
  const action = args[0];
  if (!action) throw new Error('Usage: terrarium inject <action> [--key value ...]');

  const injectArgs = parseFlags(args.slice(1));
  const world = loadRunningWorld();
  const envelopes = inject(world, action, injectArgs);
  const updated = loadPersistedWorld(process.cwd());
  console.log(`terrarium: injected ${action} (${envelopes.length} event(s))`);
  console.log(`  state:     ${updated?.meta.state_hash.slice(0, 16)}…`);
}

function cmdReplay(runId: string | undefined): void {
  const persisted = loadPersistedWorld(process.cwd());
  if (!persisted) throw new Error('No world to replay');
  if (runId && runId !== persisted.meta.run_id) {
    throw new Error(`Run ID mismatch: expected ${persisted.meta.run_id}, got ${runId}`);
  }

  const vertical = resolveVertical(persisted.meta.vertical);
  const { matches } = replayFromExport(vertical, persisted);

  console.log(`terrarium: replay ${matches ? 'OK' : 'MISMATCH'}`);
  console.log(`  events:    ${persisted.events.length}`);
  console.log(`  state:     ${persisted.meta.state_hash.slice(0, 16)}…`);
  if (!matches) {
    throw new Error('Replay state hash mismatch');
  }
}

function cmdDown(): void {
  const dir = join(process.cwd(), '.terrarium');
  rmSync(dir, { recursive: true, force: true });
  console.log('terrarium: world down');
}

function loadRunningWorld(): RunningWorld {
  const persisted = loadPersistedWorld(process.cwd());
  if (!persisted) throw new Error('No running world');

  const vertical = resolveVertical(persisted.meta.vertical);
  vertical.restoreState(persisted.vertical_state);

  const clock = new DeterministicClock(persisted.meta.seed);
  clock.restore(persisted.clock_tick);
  const eventLog = new EventLog();
  eventLog.load(persisted.events);

  return {
    meta: { ...persisted.meta },
    vertical,
    clock,
    eventLog,
    exportState: () => rebuildExport(vertical, clock, eventLog, persisted.meta),
  };
}

function rebuildExport(
  vertical: RunningWorld['vertical'],
  clock: DeterministicClock,
  eventLog: EventLog,
  meta: RunningWorld['meta'],
) {
  const snapshot = {
    meta: { ...meta, state_hash: '' },
    clock_tick: clock.getTick(),
    events: eventLog.export(),
    vertical_state: vertical.getState(),
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

function resolveVertical(name: string) {
  if (name === 'fintech') return createFintechVertical();
  throw new Error(`Unknown vertical: ${name}. Available: fintech`);
}

function countAccounts(world: RunningWorld): number {
  const state = world.vertical.getState() as { accounts?: unknown[] };
  return state.accounts?.length ?? 0;
}

function parseFlags(tokens: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('--')) {
      const key = t.slice(2).replace(/-/g, '_');
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = Number.isNaN(Number(next)) ? next : Number(next);
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function findRepoRoot(): string {
  return resolve(import.meta.dirname, '../../..');
}

function printHelp(): void {
  console.log(`terrarium — synthetic production worlds

Usage:
  terrarium up <vertical> [--scenario path] [--seed N]
  terrarium status
  terrarium advance <duration>
  terrarium inject <action> [--from id] [--to id] [--amount cents]
  terrarium replay [run-id]
  terrarium down
`);
}