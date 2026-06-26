# Inspector feedback — iteration 2

## Verdict: PASS

Iteration 2 fixes F1 from the iteration 1 feedback. The AC4 test now
asserts the actual cache path produced by `scenario install
fintech/chargeback-storm` (`installed/fintech/chargeback-storm.yaml`
with slash subdir) and adds a positive pre-remove existence check so
an install failure cannot silently mask a remove failure. All 11 ACs
are now fully verified.

## AC4 evidence (post-fix)

`packages/cli/src/scenario.test.ts:66-78`:

```ts
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
  expect(existsSync(cached)).toBe(true);   // positive: install wrote the file
  await main(['node', 'terrarium', 'scenario', 'remove', 'fintech/chargeback-storm']);
  expect(existsSync(cached)).toBe(false);  // actual deletion
});
```

Both assertions target the same path the implementation actually writes.
If install fails, the positive assertion fails first and the test cannot
mask a remove defect.

## Gate evidence (re-run on iteration 2)

```
pnpm test
  @terrarium/core              Test Files  4 passed (4)   Tests  12 passed (12)
  @terrarium/vertical-fintech  Test Files  2 passed (2)   Tests   5 passed  (5)
  @terrarium/gateway           Test Files  3 passed (3)   Tests   9 passed  (9)
  @terrarium/cli               Test Files  4 passed (4)   Tests  11 passed (11)
  Tasks: 8 successful, 8 total

pnpm typecheck                   Tasks: 7 successful, 7 total
node scripts/determinism-gate.mjs   DETERMINISM GATE OK: c379f48f… (3/3 identical)
node scripts/schedule-verify.mjs     SCHEDULE DETERMINISM GATE OK: fbf4b5c8… (3/3 identical)
node scripts/http-verify.mjs         PARITY_OK true, STATE_CHANGED true
```

## Acceptance criteria walk (final)

All 11 ACs PASS. The two non-blocking notes from iteration 1 (F2 cache
name consistency, F3 installed-prefix coverage at engine API) remain
deferred but do not block the goal.

## Iteration history

| Iter | Outcome | Key issue |
|------|---------|-----------|
| 1    | FAIL    | AC4 test asserted wrong path -> false positive on `remove` |
| 2    | PASS    | Test path corrected + positive existence check; gates green |