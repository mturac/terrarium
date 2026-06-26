import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from './main.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const CHARGEBACK = resolve(REPO_ROOT, 'scenarios', 'fintech', 'chargeback-storm.yaml');
const BASELINE = resolve(REPO_ROOT, 'scenarios', 'fintech', 'baseline.yaml');

let cwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'terrarium-cli-scenario-'));
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe('terrarium scenario', () => {
  it('installs a local path and caches manifest', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', CHARGEBACK]);

    const cached = join(cwd, '.terrarium', 'scenarios', 'installed', 'chargeback-storm.yaml');
    const manifest = join(
      cwd,
      '.terrarium',
      'scenarios',
      'installed',
      'chargeback-storm.manifest.json',
    );
    expect(existsSync(cached)).toBe(true);
    expect(existsSync(manifest)).toBe(true);
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    expect(parsed.vertical).toBe('fintech');
    expect(parsed.seed).toBe(9001);
    expect(parsed.schedule_count).toBe(2);
  });

  it('installs a bare ref by resolving against repo scenarios', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', 'fintech/chargeback-storm']);
    const cached = join(
      cwd,
      '.terrarium',
      'scenarios',
      'installed',
      'fintech',
      'chargeback-storm.yaml',
    );
    expect(existsSync(cached)).toBe(true);
  });

  it('lists installed scenarios', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', BASELINE]);
    await main(['node', 'terrarium', 'scenario', 'install', 'fintech/chargeback-storm']);
    await main(['node', 'terrarium', 'scenario', 'list']);
    // No throw => success
  });

  it('removes an installed scenario', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', 'fintech/chargeback-storm']);
    const cached = join(
      cwd,
      '.terrarium',
      'scenarios',
      'installed',
      'fintech',
      'chargeback-storm.yaml',
    );
    expect(existsSync(cached)).toBe(true);
    await main(['node', 'terrarium', 'scenario', 'remove', 'fintech/chargeback-storm']);
    expect(existsSync(cached)).toBe(false);
  });

  it('rejects removal of unknown scenario with non-zero exit message', async () => {
    await expect(
      main(['node', 'terrarium', 'scenario', 'remove', 'nope/not-real']),
    ).rejects.toThrow(/not installed/i);
  });

  it('runs scheduled scenario via up --scenario installed:<name>', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', 'fintech/chargeback-storm']);
    await main([
      'node',
      'terrarium',
      'up',
      'fintech',
      '--scenario',
      'installed:fintech/chargeback-storm',
    ]);
    const world = JSON.parse(readFileSync(join(cwd, '.terrarium', 'world.json'), 'utf8'));
    // Schedule has 2 transfers, each emits >=2 envelopes (transfer.created + transfer.settled)
    expect(world.events.length).toBeGreaterThanOrEqual(4);
    expect(world.meta.scenario).toBe('installed:fintech/chargeback-storm');
  });

  it('rejects install with invalid yaml', async () => {
    const bad = join(cwd, 'bad.yaml');
    writeFileSync(
      bad,
      `apiVersion: terrarium.dev/v1\nkind: Scenario\nmetadata:\n  name: nope\nspec:\n  vertical: fintech\n  seed: not-a-number\n  population: 1\n  schedule: []\n`,
    );
    await expect(main(['node', 'terrarium', 'scenario', 'install', bad])).rejects.toThrow();
  });

  it('installs to .terrarium/scenarios/installed subdir', async () => {
    await main(['node', 'terrarium', 'scenario', 'install', 'fintech/chargeback-storm']);
    const dir = join(cwd, '.terrarium', 'scenarios', 'installed');
    expect(existsSync(dir)).toBe(true);
    mkdirSync(dir, { recursive: true }); // sanity check
  });
});
