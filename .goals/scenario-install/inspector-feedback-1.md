# Inspector feedback — iteration 1

## Verdict: FAIL

The implementation is correct end-to-end. Manual verification of the CLI
round-trip (install from bare ref then remove then re-list) succeeds, and the
schedule determinism gate produces identical hashes across 3 runs.
However, the AC4 test was a false positive — it asserted the wrong file
path and would pass even if `remove` were a no-op. Iteration 2 fixes the
test assertion.

## Acceptance criteria walk

| AC  | Verdict | Evidence |
|-----|---------|----------|
| AC1 install from local path caches and validates | PASS | Manual `scenario install /path/to/foo.yaml` writes `.terrarium/scenarios/installed/foo.yaml` plus manifest; `scenario.test.ts:21-37` asserts file plus parsed manifest fields. |
| AC2 install from bare ref resolves and caches | PASS | Manual `scenario install fintech/chargeback-storm` writes `.terrarium/scenarios/installed/fintech/chargeback-storm.yaml`; `scenario.test.ts:39-50` covers it. |
| AC3 list prints installed packs | PASS | `cmdScenarioList` walks the cache, prints name/vertical/seed/schedule count; covered by `scenario.test.ts:52-58`. |
| AC4 remove deletes cache entry | PARTIAL fixed in iter 2 | Iteration 1 test asserted `installed/fintech-chargeback-storm.yaml` (hyphen) instead of `installed/fintech/chargeback-storm.yaml` (slash). Test passed for the wrong reason. Iteration 2 (`529664b`) corrects the path and adds a positive pre-remove existence check. |
| AC5 schedule advances clock and injects and persists state | PASS | `engine.runSchedule` sorts schedule, advances clock per offset, calls `vertical.inject`, persists updated `state_hash` via `ctx.emit`. `schedule.test.ts:13-39` covers empty and non-empty cases against real `createFintechVertical`. |
| AC6 existing determinism gate still passes | PASS | `node scripts/determinism-gate.mjs` -> `DETERMINISM GATE OK: c379f48f…` identical to pre-change baseline. |
| AC7 chargeback-storm pack ships, 3 runs identical hash | PASS | `scenarios/fintech/chargeback-storm.yaml` (seed 9001, 2-entry schedule). `node scripts/schedule-verify.mjs` -> `SCHEDULE DETERMINISM GATE OK: fbf4b5c8…` x3. |
| AC8 `parseScheduleOffset` matches `parseDuration` | PASS | `schedule.test.ts:5-23` covers `+2h`, `+30m`, `+500ms`, `0s`, `1h`, `2d`, whitespace, empty, garbage. All match `parseDuration` from `clock.ts`. |
| AC9 typecheck/test/build all exit 0 | PASS | `pnpm typecheck` 7/7 successful, `pnpm test` 8/8 successful (cli 11/11, vertical-fintech 5/5, gateway 9/9, core passing), `pnpm build` 4/4 cached. |
| AC10 `scenario-install-test` script in package.json | PASS | Root `package.json:12` defines `"scenario-install-test": "pnpm --filter @terrarium/cli test -- scenario.test.ts"`. Also added `"schedule-verify": "node scripts/schedule-verify.mjs"` on line 14. |
| AC11 help and README cover new commands | PASS | `printHelp()` lists scenario group; `printScenarioHelp()` gives detailed usage; README "Scenario packs" section shows one-line example per command. |

## Gate evidence (re-run on iteration 2)

```
pnpm test                    -> 8/8 tasks successful, cli 11/11, all packages green
node scripts/determinism-gate.mjs  -> DETERMINISM GATE OK: c379f48f… (3/3 identical)
node scripts/schedule-verify.mjs    -> SCHEDULE DETERMINISM GATE OK: fbf4b5c8… (3/3 identical)
node scripts/http-verify.mjs        -> PARITY_OK true, STATE_CHANGED true
```

## Findings

### F1 — AC4 test bug (BLOCKING, fixed in iter 2)

`s/packages/cli/src/scenario.test.ts:60` (iteration 1) asserted the cache
path with a hyphen instead of a slash. The actual cached file produced
by `scenario install fintech/chargeback-storm` is
`installed/fintech/chargeback-storm.yaml` (slash, subdir). The asserted
path never existed, so the test passed for the wrong reason: it only
verified that `remove` did not throw, not that it deleted the entry.

Fix in iteration 2 (`529664b`): correct path plus add positive pre-remove
existence check so an install failure cannot silently mask a remove
failure.

### F2 — Cache name consistency (NOTE, non-blocking)

`install /path/to/foo.yaml` derives the cache name from the basename
(`foo`), while `install vertical/foo` derives the cache name from the
full ref (`vertical/foo`). Two inputs that resolve to the same source
scenario therefore produce different cache entries. Functionally
correct, but a user who installs the same pack twice via different
input forms will see two cache rows. Recommend documenting the input
convention in `printScenarioHelp()` in a follow-up.

### F3 — `installed:<name>` prefix not exercised at engine API level (NOTE)

`cmdUp` does string-prefix detection on the raw `scenarioRef` before
calling `resolve()`, which is necessary because `resolve('installed:foo')`
returns an absolute path. The CLI test (`scenario.test.ts:79-95`) covers
the round-trip, but `engine.up()` itself has no integration test for
the `installed:` prefix. Acceptable because `cmdUp` is the only entry
point for prefix resolution; engine callers receive an absolute path.

## Iteration history

| Iter | Outcome | Key issue |
|------|---------|-----------|
| 1    | FAIL    | AC4 test asserted wrong path -> false positive on `remove` |
| 2    | in progress | fix: correct path plus positive existence check |