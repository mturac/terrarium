# Contributing to Terrarium

Terrarium is a community-facing synthetic production platform. We optimize for **determinism**, **replay**, and **vertical depth** — not demo breadth.

## Before you open a PR

1. Run `pnpm install && pnpm test && pnpm typecheck`.
2. If your change affects world state, add or update a determinism test.
3. New verticals must implement the `Vertical` interface in `@terrarium/core` and ship a spec under `docs/verticals/`.

## Scenario packs

Community scenarios live under `scenarios/<vertical>/`. Each pack needs:

- `apiVersion: terrarium.dev/v1`
- Documented seed and expected `state_hash` after replay
- CI verification via `pnpm test --filter @terrarium/core`

## Code style

- TypeScript strict mode
- No `any` without justification in PR description
- Prefer pure functions in the rules engine; side effects only via event log

## License

By contributing, you agree your contributions are licensed under Apache-2.0.