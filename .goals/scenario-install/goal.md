# Goal — Scenario install + scheduled injection runner

## Context

Terrarium v0.1.1 Tesseract phase closed at `dd05637`. Scenarios already have a
`schedule: ScheduledInjection[]` field in `ScenarioSpec`, and
`loadScenarioFromFile` validates it, but nothing currently **executes** the
schedule — `up()` calls `vertical.bootstrap(ctx)` and stops. Community
integrators can't run packs like the chargeback-storm example in `VISION.md`
without a runner.

This goal delivers the v0.2 build-order step **"Scenario registry +
`terrarium scenario install`"** end-to-end.

## What the user wants

A working scenario install + schedule runner that lets community integrators
do:

```bash
terrarium scenario install scenarios/fintech/chargeback-storm.yaml
# or
terrarium scenario install fintech/chargeback-storm    # built-in ref

terrarium scenario list
terrarium up fintech --scenario installed:fintech/chargeback-storm
terrarium status
terrarium replay

terrarium scenario remove fintech/chargeback-storm
```

When a scenario has a non-empty `schedule:`, the runner must fire each
`ScheduledInjection` deterministically against the world — advancing the clock
to the offset, calling `vertical.inject(action, args, ctx)`, and persisting
the updated `state_hash`.

## Acceptance criteria

Measurable conditions for "done":

| #    | Criterion                                                                                                                                                                                                                                              | Verification                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| AC1  | `terrarium scenario install <local-path>` validates the yaml against the existing zod schema, copies it to `.terrarium/scenarios/installed/<name>.yaml`, and exits 0.                                                                                  | New CLI test: install a fixture yaml, assert file exists + parsed spec round-trips.    |
| AC2  | `terrarium scenario install <bare-ref>` (e.g. `fintech/chargeback-storm`) resolves to `scenarios/<vertical>/<ref-suffix>.yaml` in the repo, validates, copies to cache.                                                                                | New CLI test.                                                                          |
| AC3  | `terrarium scenario list` prints one row per installed pack: name, vertical, seed, schedule count.                                                                                                                                                     | New CLI test.                                                                          |
| AC4  | `terrarium scenario remove <name>` deletes the cache entry, exits 0; missing pack exits non-zero with a clear message.                                                                                                                                 | New CLI test.                                                                          |
| AC5  | `terrarium up fintech --scenario installed:<name>` runs the schedule: advances clock to each `at` offset, fires the inject, appends events, persists new `state_hash`. Empty schedule behaves identically to today.                                    | New core test in `packages/core`.                                                      |
| AC6  | The existing CI determinism gate (`pnpm determinism-gate`) still passes — three clean baseline runs (empty schedule) must produce the same `state_hash` as before.                                                                                     | Run `node scripts/determinism-gate.mjs` after build, must print `DETERMINISM GATE OK`. |
| AC7  | A new `scenarios/fintech/chargeback-storm.yaml` pack ships (referenced in `VISION.md`), with a non-empty schedule. Running `terrarium up fintech --scenario scenarios/fintech/chargeback-storm.yaml` 3× in fresh dirs produces identical `state_hash`. | New core + CLI test (or extend determinism gate with a scheduled-run mode).            |
| AC8  | `parseScheduleOffset("+2h")`, `parseScheduleOffset("+30m")`, `parseScheduleOffset("0s")` all return milliseconds consistent with the existing `parseDuration`.                                                                                         | Unit test in core.                                                                     |
| AC9  | `pnpm typecheck`, `pnpm test`, `pnpm build` all exit 0 across the workspace.                                                                                                                                                                           | Run all three; must exit 0.                                                            |
| AC10 | `package.json` scripts include `pnpm scenario-install-test` (or equivalent) that exercises AC1–AC5 without hitting the network.                                                                                                                        | Inspect root `package.json` after implementation.                                      |
| AC11 | `printHelp()` lists the four new subcommands under a `scenario` group; `README.md` shows a one-line example per new command.                                                                                                                           | Manual inspect of dist help output + README diff.                                      |

## Scope boundaries (Non-goals)

- **No remote marketplace registry** — no HTTP fetch, no signed packs, no
  remote index. `install` only accepts a local path or a built-in repo ref.
- **No live re-scheduling** — schedule runs once at `up` time. There is no
  scheduler thread that fires mid-session; users still use
  `terrarium advance` + `terrarium inject` for ongoing work.
- **No HTTP gateway changes** — `docs/gateway-openapi.yaml` and the gateway
  package stay untouched. The schedule runner is a CLI/core feature only.
- **No Witness/Loom integration** — unchanged.
- **No SDK package** — `@terrarium/sdk` stays out of scope.
- **No additional verticals** — fintech only.

## Discovered project conventions

| Convention                             | Source                                                                                                                                           | Action                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Commit format                          | `git log --oneline` shows `feat(scope): description`, `fix(scope): description`                                                                  | Builder commits follow same format with `[B]` marker     |
| TS strict + `noUncheckedIndexedAccess` | root `tsconfig.json`                                                                                                                             | All new code must satisfy both                           |
| Zod for yaml validation                | `packages/core/src/scenario.ts`                                                                                                                  | Reuse `ScenarioSchema` for install-time validation       |
| Vitest per package                     | every `package.json` `test` script                                                                                                               | New tests land in the package they exercise              |
| Workspace deps via `workspace:*`       | every package manifest                                                                                                                           | Maintain this pattern                                    |
| Determinism gate                       | `scripts/determinism-gate.mjs`                                                                                                                   | Re-run after changes; must stay green                    |
| HTTP parity gate                       | `scripts/http-verify.mjs`                                                                                                                        | Re-run; should still pass (no gateway changes)           |
| CI workflow                            | `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && determinism-gate && http-verify` | All six steps must remain green                          |
| Prettier                               | `.prettierrc`                                                                                                                                    | `pnpm format` before commit if any non-test files change |

## Reference files for the Builder

- `packages/core/src/scenario.ts` — `ScenarioSchema` (zod) + `loadScenarioFromFile` (reuse for install)
- `packages/core/src/engine.ts` — `up()`, `inject()`, `advance()` (extend `up()` to drive schedule)
- `packages/core/src/types.ts` — `ScenarioSpec`, `ScheduledInjection` (use as-is)
- `packages/core/src/clock.ts` — `parseDuration()` (reuse for `parseScheduleOffset("+2h")`)
- `packages/cli/src/main.ts` — `main()` switch + `printHelp()` (add `scenario` subcommand)
- `scripts/determinism-gate.mjs` — extend with a scheduled-run branch or add `scripts/schedule-verify.mjs`
- `scenarios/fintech/baseline.yaml` — template for the new `chargeback-storm.yaml`
- `VISION.md` lines 79–94 — canonical chargeback-storm shape

## Definition of done

A reviewer can:

1. `pnpm install`
2. `pnpm build`
3. `pnpm exec terrarium scenario install scenarios/fintech/chargeback-storm.yaml`
4. `pnpm exec terrarium scenario list`
5. `pnpm exec terrarium up fintech --scenario installed:fintech/chargeback-storm`
6. `pnpm exec terrarium replay`
7. `pnpm test`
8. `pnpm typecheck`
9. `node scripts/determinism-gate.mjs`

…all without errors, and steps 3–6 leave the working tree with a non-empty
`world.json` whose schedule-derived `state_hash` is reproducible across runs.
