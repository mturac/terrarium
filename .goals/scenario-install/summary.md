# Goal summary — scenario install + scheduled injection runner

## Status: COMPLETED (PASS, iteration 2)

## What was achieved

The full scenario install path is now wired end-to-end. Community
integrators can install a scenario pack once, then reference it by a
stable cached name in any project — no raw paths in commit history,
no copying yaml files between repos.

### User impact

```bash
terrarium scenario install fintech/chargeback-storm
# -> caches to .terrarium/scenarios/installed/fintech/chargeback-storm.yaml
#    with sibling .manifest.json (vertical, seed, schedule_count)

terrarium scenario list
# -> enumerates the cache, prints name/vertical/seed/schedule

terrarium up fintech --scenario installed:fintech/chargeback-storm
# -> runs the schedule: advances the deterministic clock to each
#    offset, calls vertical.inject(action, args, ctx), persists
#    the updated state_hash

terrarium scenario remove fintech/chargeback-storm
# -> deletes the cache entry, exits 0; missing pack exits non-zero
```

### Acceptance criteria — all 11 met

| AC | Status |
|----|--------|
| AC1 install from local path | PASS |
| AC2 install from bare ref | PASS |
| AC3 list installed packs | PASS |
| AC4 remove deletes cache entry | PASS (corrected in iter 2) |
| AC5 schedule advances + injects + persists | PASS |
| AC6 determinism gate unchanged | PASS — `c379f48f…` x3 |
| AC7 chargeback-storm pack 3× identical hash | PASS — `fbf4b5c8…` x3 |
| AC8 `parseScheduleOffset` matches `parseDuration` | PASS |
| AC9 typecheck/test/build exit 0 | PASS — 7/7, 8/8, 4/4 |
| AC10 `scenario-install-test` + `schedule-verify` scripts | PASS |
| AC11 help + README cover new commands | PASS |

## Iteration history

| Iter | Verdict | Notes |
|------|---------|-------|
| 1    | FAIL    | AC4 test asserted `installed/fintech-chargeback-storm.yaml` (hyphen) which never existed; actual file is `installed/fintech/chargeback-storm.yaml` (slash subdir). Test passed for wrong reason — only proved `remove` did not throw, not that it deleted. |
| 2    | PASS    | Test path corrected and a positive pre-remove existence check added. All gates green. |

## Key issues raised and resolved

- **F1 (BLOCKING, iter 2 fix):** `scenario.test.ts` remove assertion
  pointed at a non-existent hyphenated path. Fixed in `529664b`:
  corrected path + positive existence check before remove so an
  install failure cannot silently mask a remove failure.
- **F2 (NOTE, deferred):** install-from-path uses basename-derived
  cache name; install-from-ref uses full-ref cache name. Same source
  scenario can therefore produce two cache entries. Recommend
  documenting in `printScenarioHelp()` in a follow-up.
- **F3 (NOTE, deferred):** `installed:<name>` resolution is only
  exercised at the CLI layer; no engine-level integration test.
  Acceptable because `cmdUp` is the only entry point.

## Key files

- `packages/core/src/schedule.ts` — `parseScheduleOffset`, `sortSchedule`
- `packages/core/src/engine.ts` — `runSchedule` + extended `up()`
- `packages/cli/src/main.ts` — `scenario install|list|remove`, `installed:<name>` resolution
- `scenarios/fintech/chargeback-storm.yaml` — reference pack (seed 9001, 2-entry schedule)
- `scripts/schedule-verify.mjs` — 3-run determinism gate
- `.goals/scenario-install/{goal.md,status.json,inspector-feedback-{1,2}.md,summary.md}`

## Recommendations for the user

1. **Document cache-name derivation** in `printScenarioHelp()` so
   users understand that `install foo/bar.yaml` and `install foo/bar`
   produce different cache names. Closes F2.
2. **Add a CI step** that runs `pnpm schedule-verify` alongside the
   existing `determinism-gate` and `http-verify` gates so the
   scheduled-scenario invariant is enforced on every PR.
3. **Consider an `installed:<name>` engine-level test** to harden
   F3, even though CLI coverage is sufficient today.
4. **Phase Tesseract close-out**: this goal fulfils the
   "Scenario registry + `terrarium scenario install`" step in the
   v0.2 build order. The next natural goal is either
   (a) a second vertical (e-commerce) to validate the plugin
   interface works beyond fintech, or
   (b) Witness export so committed worlds can be replayed across
   CI jobs without rebuilding.