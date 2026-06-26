# Terrarium

**A deterministic synthetic production universe for developers, QA, and agent builders.**

Terrarium is not a mock server. It is a replayable world: fake users, real event semantics, webhook delivery, and controllable time — packaged so anyone can run `terrarium up fintech` and get a production-shaped environment in seconds.

## Problem

Teams testing agents, integrations, and workflows against production systems face the same wall:

- Staging is shared, flaky, and expensive.
- Mocks return canned JSON with no causal history.
- Time-based behavior (billing cycles, retries, SLA windows) cannot be fast-forwarded deterministically.
- Incidents cannot be reproduced byte-for-byte for audit or compliance.

Terrarium replaces "hope staging works" with **worlds you own**.

## Category

| Incumbent gap                   | Terrarium answer                                              |
| ------------------------------- | ------------------------------------------------------------- |
| WireMock / Prism — static stubs | Stateful worlds with population, ledger, webhooks             |
| LocalStack — AWS-shaped         | Domain verticals (fintech, e-commerce, …) with scenario packs |
| Testcontainers — real DBs       | Synthetic users + deterministic clock + event log             |
| Agent sandboxes — ephemeral     | Replayable runs exportable to Witness                         |

## Core primitives

1. **World** — A running vertical instance (`fintech`, `ecommerce`, …) with seeded population and initial ledger.
2. **Deterministic clock** — Virtual time advanced by `terrarium advance 6h`; same seed + same commands ⇒ same state.
3. **Event log** — Append-only, hash-chained envelope per action (Witness-compatible shape).
4. **Injection** — `terrarium inject transfer …` applies domain events through the vertical rules engine.
5. **Scenario** — Versioned pack declaring seed, population, scheduled injections, expected invariants.
6. **Replay** — Re-execute a run from event log; diff against golden state.

## CLI (v0.1 contract)

```bash
terrarium up fintech [--seed 42] [--scenario baseline]
terrarium status
terrarium advance 1h
terrarium inject transfer --from acct_1 --to acct_2 --amount 25000 --currency USD
terrarium replay <run-id>
terrarium export --format json
terrarium down
```

Every command must work offline. No cloud dependency for core loop.

## HTTP gateway (v0.1.1)

```bash
terrarium up fintech --seed 42
terrarium serve --port 8787
curl -X POST http://127.0.0.1:8787/v1/transfers \
  -H 'Content-Type: application/json' \
  -d '{"amount":25000,"currency":"usd","source":"acct_0001","destination":"acct_0002"}'
```

Stripe-shaped transfer create hits the same `inject('transfer')` path as the CLI. Responses include `state_hash` for audit/replay workflows.

## Vertical: Fintech (first ship)

See [docs/verticals/fintech.md](./docs/verticals/fintech.md).

Minimum real surface:

- Accounts with KYC tier, balance, hold state
- Internal transfers with idempotency keys
- Outbound webhooks (`transfer.settled`, `account.created`, `compliance.flag`)
- Synthetic users (10k-capable generator; v0.1 ships 50 baseline personas)
- Scheduled jobs simulated via clock (daily settlement batch)

## Marketplace (v0.2+)

Scenario packs ship as `terrarium-scenario` manifests:

```yaml
apiVersion: terrarium.dev/v1
kind: Scenario
metadata:
  name: fintech/chargeback-storm
spec:
  vertical: fintech
  seed: 9001
  population: 500
  schedule:
    - at: +0m
      inject: account.open_bulk
      args: { count: 500 }
    - at: +2h
      inject: transfer.burst
      args: { tps: 50, duration: 30m }
```

Community publishes packs; Terrarium verifies determinism in CI before listing.

## SDK

`@terrarium/sdk` exposes the same engine headlessly:

```ts
import { TerrariumClient } from '@terrarium/sdk';

const world = await TerrariumClient.up({ vertical: 'fintech', seed: 42 });
await world.advance({ hours: 6 });
const log = await world.exportEventLog();
```

## Relationship to Witness & Loom

- **Witness** — Consumes Terrarium event envelopes as provenance input; `witness replay` can rebuild agent decisions against a Terrarium run.
- **Loom** — Long-running agent workflows checkpoint against Terrarium world state; failures resume from last envelope sequence.

Terrarium is deliberately standalone. No hard dependency on sibling projects in v0.1.

## Success gates (not MVP theater)

| Gate        | Evidence                                                               |
| ----------- | ---------------------------------------------------------------------- |
| Determinism | Same seed + scenario ⇒ identical final state hash across 3 runs        |
| Replay      | `terrarium replay` reproduces state from exported log                  |
| Webhooks    | At least 3 event types delivered to local sink with signed payloads    |
| Population  | 50 synthetic users with stable identities from seed                    |
| Community   | CONTRIBUTING.md, scenario schema, vertical plugin interface documented |

## Build order

1. Core engine + fintech vertical + CLI (this repo)
2. Scenario registry + `terrarium scenario install`
3. HTTP gateway mimicking common fintech API shapes
4. Second vertical (e-commerce) to prove plugin model

## License

Apache-2.0 — commercial-friendly, community-safe.
