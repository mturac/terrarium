import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ScenarioSpec } from './types.js';

const ScenarioSchema = z.object({
  apiVersion: z.literal('terrarium.dev/v1'),
  kind: z.literal('Scenario'),
  metadata: z.object({
    name: z.string(),
    version: z.string().optional(),
    description: z.string().optional(),
  }),
  spec: z.object({
    vertical: z.string(),
    seed: z.number().int(),
    population: z.number().int().positive(),
    initial_balance_cents: z.number().int().nonnegative().optional(),
    currency: z.string().optional(),
    webhook_sink: z.string().optional(),
    schedule: z
      .array(
        z.object({
          at: z.string(),
          inject: z.string(),
          args: z.record(z.unknown()),
        }),
      )
      .default([]),
  }),
});

export function loadScenarioFromFile(path: string): ScenarioSpec {
  const raw = readFileSync(path, 'utf8');
  const doc = parseYaml(raw);
  const parsed = ScenarioSchema.parse(doc);
  return parsed.spec;
}

export function defaultFintechBaseline(): ScenarioSpec {
  return {
    vertical: 'fintech',
    seed: 42,
    population: 50,
    initial_balance_cents: 100_000,
    currency: 'USD',
    webhook_sink: '.terrarium/webhooks.jsonl',
    schedule: [],
  };
}

/** Single fallback when persisted world lacks scenario_spec (session + inject paths). */
export function fallbackScenarioSpec(vertical: string, seed: number): ScenarioSpec {
  return {
    ...defaultFintechBaseline(),
    vertical,
    seed,
  };
}