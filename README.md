# Terrarium

Deterministic synthetic production worlds for developers, QA, and agent builders.

```bash
pnpm install
pnpm build
pnpm exec terrarium up fintech
pnpm exec terrarium status
pnpm exec terrarium inject transfer --from acct_0001 --to acct_0002 --amount 25000
pnpm exec terrarium replay
```

## What you get

- **50 synthetic users** with funded accounts (baseline scenario)
- **Hash-chained event log** — Witness-compatible provenance shape
- **Webhook deliveries** written to `.terrarium/webhooks.jsonl`
- **Deterministic clock** — `terrarium advance 6h` fast-forwards virtual time
- **Replay verification** — same seed ⇒ same `state_hash`

## Docs

- [VISION.md](./VISION.md) — category, primitives, roadmap
- [docs/verticals/fintech.md](./docs/verticals/fintech.md) — entity model, rules, events

## Packages

| Package | Role |
|---------|------|
| `@terrarium/core` | Clock, event log, engine, scenario loader |
| `@terrarium/vertical-fintech` | Fintech world rules |
| `@terrarium/cli` | `terrarium` command |

## License

Apache-2.0