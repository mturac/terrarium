import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  advance,
  inject,
  loadPersistedWorld,
  loadRunningWorld,
  loadScenarioFromFile,
  replayFromExport,
  up,
  type RunningWorld,
  type ScenarioSpec,
} from '@terrarium/core';
import { createGateway } from '@terrarium/gateway';
import { createFintechVertical } from '@terrarium/vertical-fintech';

const SCENARIO_CACHE_DIR = join('.terrarium', 'scenarios', 'installed');

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
    case 'serve':
      await cmdServe(args.slice(1));
      return;
    case 'scenario':
      cmdScenario(args.slice(1));
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

  let scenarioRef: string | null = null;
  let seedOverride: number | null = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      scenarioRef = args[++i]!;
    } else if (args[i] === '--seed' && args[i + 1]) {
      seedOverride = Number(args[++i]);
    }
  }

  const vertical = resolveVertical(verticalName);
  const resolvedScenario = resolveScenarioRef(scenarioRef, verticalName);
  const scenario = loadScenarioFromFile(resolvedScenario);
  if (seedOverride !== null) scenario.seed = seedOverride;

  const world = up({
    vertical,
    scenario,
    scenarioName: scenarioRef ?? `${verticalName}/baseline`,
    cwd: process.cwd(),
  });

  console.log('terrarium: world up');
  console.log(`  run_id:    ${world.meta.run_id}`);
  console.log(`  vertical:  ${world.meta.vertical}`);
  console.log(`  seed:      ${world.meta.seed}`);
  console.log(`  scenario:  ${world.meta.scenario}`);
  console.log(`  accounts:  ${countAccounts(world)}`);
  if (scenario.schedule.length > 0) {
    console.log(`  schedule:  ${scenario.schedule.length} injection(s) executed`);
  }
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
  const world = loadWorld();
  const meta = advance(world, duration);
  console.log('terrarium: advanced');
  console.log(`  clock:     tick ${world.clock.getTick()}`);
  console.log(`  state:     ${meta.state_hash.slice(0, 16)}…`);
}

function cmdInject(args: string[]): void {
  const action = args[0];
  if (!action) throw new Error('Usage: terrarium inject <action> [--key value ...]');

  const injectArgs = parseFlags(args.slice(1));
  const world = loadWorld();
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

function cmdScenario(args: string[]): void {
  const sub = args[0];
  switch (sub) {
    case 'install':
      cmdScenarioInstall(args[1]);
      return;
    case 'list':
      cmdScenarioList();
      return;
    case 'remove':
      cmdScenarioRemove(args[1]);
      return;
    case undefined:
    case 'help':
      printScenarioHelp();
      return;
    default:
      throw new Error(`Unknown scenario subcommand: ${sub}`);
  }
}

function cmdScenarioInstall(ref: string | undefined): void {
  if (!ref) {
    throw new Error(
      'Usage: terrarium scenario install <ref>\n  ref = local path or "<vertical>/<pack>" built-in',
    );
  }
  const sourcePath = resolveScenarioSource(ref);
  const spec = loadScenarioFromFile(sourcePath);
  const name = deriveScenarioName(ref, sourcePath);
  const cacheDir = join(process.cwd(), SCENARIO_CACHE_DIR);
  const targetPath = join(cacheDir, `${name}.yaml`);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);

  const manifest = {
    name,
    source: sourcePath,
    installed_at: new Date().toISOString(),
    vertical: spec.vertical,
    seed: spec.seed,
    schedule_count: spec.schedule.length,
  };
  writeFileSync(join(cacheDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2));

  console.log(`terrarium: scenario installed`);
  console.log(`  name:      ${name}`);
  console.log(`  source:    ${sourcePath}`);
  console.log(`  vertical:  ${spec.vertical}`);
  console.log(`  seed:      ${spec.seed}`);
  console.log(`  schedule:  ${spec.schedule.length} injection(s)`);
  console.log(`  cached:    ${targetPath}`);
}

function cmdScenarioList(): void {
  const cacheDir = join(process.cwd(), SCENARIO_CACHE_DIR);
  if (!existsSync(cacheDir)) {
    console.log('terrarium: no installed scenarios');
    return;
  }
  const yamls = collectCachedYamls(cacheDir);
  if (yamls.length === 0) {
    console.log('terrarium: no installed scenarios');
    return;
  }
  console.log(`terrarium: ${yamls.length} installed scenario(s)`);
  for (const rel of yamls) {
    const spec = loadScenarioFromFile(join(cacheDir, rel));
    const display = rel.replace(/\.yaml$/, '');
    console.log(
      `  - ${display}  vertical=${spec.vertical}  seed=${spec.seed}  schedule=${spec.schedule.length}`,
    );
  }
}

function cmdScenarioRemove(name: string | undefined): void {
  if (!name) throw new Error('Usage: terrarium scenario remove <name>');
  const cacheDir = join(process.cwd(), SCENARIO_CACHE_DIR);
  const targetPath = join(cacheDir, `${name}.yaml`);
  const manifestPath = join(cacheDir, `${name}.manifest.json`);
  if (!existsSync(targetPath) && !existsSync(manifestPath)) {
    throw new Error(`Scenario not installed: ${name}`);
  }
  if (existsSync(targetPath)) rmSync(targetPath);
  if (existsSync(manifestPath)) rmSync(manifestPath);
  console.log(`terrarium: scenario removed: ${name}`);
}

function collectCachedYamls(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        out.push(full.slice(dir.length + 1));
      }
    }
  }
  return out.sort();
}

function resolveScenarioSource(ref: string): string {
  // Bare repo reference like "<vertical>/<pack>" (no .yaml/.yml extension).
  if (!ref.endsWith('.yaml') && !ref.endsWith('.yml')) {
    const builtIn = resolve(findRepoRoot(), 'scenarios', `${ref}.yaml`);
    if (existsSync(builtIn)) return builtIn;
    throw new Error(`Built-in scenario not found: ${ref}`);
  }
  const local = resolve(ref);
  if (!existsSync(local)) {
    throw new Error(`Scenario source not found: ${ref}`);
  }
  return local;
}

function deriveScenarioName(ref: string, sourcePath: string): string {
  // User intent wins: if they passed "<vertical>/<pack>" keep it; else drop extension.
  if (!ref.endsWith('.yaml') && !ref.endsWith('.yml')) return ref;
  const base = sourcePath.split('/').pop() ?? 'scenario';
  return base.replace(/\.ya?ml$/, '');
}

function resolveScenarioRef(scenarioRef: string | null, verticalName: string): string {
  if (scenarioRef) {
    if (scenarioRef.startsWith('installed:')) {
      const name = scenarioRef.slice('installed:'.length);
      const cached = join(process.cwd(), SCENARIO_CACHE_DIR, `${name}.yaml`);
      if (!existsSync(cached)) {
        throw new Error(
          `Installed scenario not found: ${name}. Run: terrarium scenario install ${name}`,
        );
      }
      return cached;
    }
    return resolveScenarioSource(scenarioRef);
  }
  return resolve(findRepoRoot(), 'scenarios', verticalName, 'baseline.yaml');
}

function loadWorld(): RunningWorld {
  const persisted = loadPersistedWorld(process.cwd());
  if (!persisted) throw new Error('No running world');
  return loadRunningWorld(process.cwd(), resolveVertical(persisted.meta.vertical));
}

async function cmdServe(args: string[]): Promise<void> {
  let port = 8787;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    }
  }

  if (!loadPersistedWorld(process.cwd())) {
    throw new Error('No running world. Run: terrarium up fintech');
  }

  const gw = await createGateway({ cwd: process.cwd(), port });
  console.log(`terrarium: gateway listening on ${gw.url}`);
  console.log('  POST /v1/transfers       — Stripe-like transfer create');
  console.log('  GET  /v1/transfers/:id   — retrieve transfer');
  console.log('  GET  /v1/transfers       — list transfers');
  console.log('  GET  /v1/status          — world state_hash');
  console.log('  GET  /v1/health          — liveness');
  console.log('  GET  /v1/openapi.yaml    — gateway OpenAPI spec');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      gw.close().then(resolve).catch(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
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

function printScenarioHelp(): void {
  console.log(`terrarium scenario — install/list/remove community scenario packs

Usage:
  terrarium scenario install <ref>     # local path or "<vertical>/<pack>"
  terrarium scenario list              # show installed packs
  terrarium scenario remove <name>     # delete from cache
`);
}

function printHelp(): void {
  console.log(`terrarium — synthetic production worlds

Usage:
  terrarium up <vertical> [--scenario path|installed:<name>] [--seed N]
  terrarium status
  terrarium advance <duration>
  terrarium inject <action> [--from id] [--to id] [--amount cents]
  terrarium replay [run-id]
  terrarium serve [--port 8787]
  terrarium down
  terrarium scenario install <ref>
  terrarium scenario list
  terrarium scenario remove <name>
`);
}

// Suppress unused import warning for dirname (kept for future webhook sink changes).
void dirname;
