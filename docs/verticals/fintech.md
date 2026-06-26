# Fintech vertical specification

**Status:** v0.1 (implemented in `@terrarium/vertical-fintech`)  
**Audience:** Integration engineers, agent builders, QA leads

## Purpose

Provide a production-shaped financial substrate without connecting to real money movement. Every account, transfer, and webhook follows rules explicit enough to test agents and automations against edge cases (holds, idempotency, settlement windows).

## Entities

### Account

| Field           | Type                             | Notes                       |
| --------------- | -------------------------------- | --------------------------- |
| `id`            | `acct_*`                         | Stable from seed + index    |
| `owner_id`      | `user_*`                         | Links to synthetic user     |
| `currency`      | ISO 4217                         | USD default in baseline     |
| `balance_cents` | int                              | Never negative after commit |
| `hold_cents`    | int                              | Pending outbound            |
| `kyc_tier`      | 0–3                              | Affects transfer limits     |
| `status`        | `active` \| `frozen` \| `closed` |                             |

### Transfer

| Field             | Type                               | Notes                          |
| ----------------- | ---------------------------------- | ------------------------------ |
| `id`              | `txn_*`                            |                                |
| `idempotency_key` | string                             | Duplicate key returns same txn |
| `from_account_id` | string                             |                                |
| `to_account_id`   | string                             |                                |
| `amount_cents`    | int                                | > 0                            |
| `currency`        | string                             | Must match both accounts       |
| `status`          | `pending` \| `settled` \| `failed` |                                |
| `created_at`      | virtual timestamp                  | From deterministic clock       |
| `settled_at`      | virtual timestamp \| null          | Set on settlement batch        |

### Synthetic user

| Field          | Type     | Notes                   |
| -------------- | -------- | ----------------------- |
| `id`           | `user_*` |                         |
| `display_name` | string   | Generated from seed     |
| `email`        | string   | `{id}@terrarium.local`  |
| `risk_score`   | 0.0–1.0  | Drives compliance flags |

### Webhook delivery

| Field          | Type              | Notes                    |
| -------------- | ----------------- | ------------------------ |
| `id`           | `wh_*`            |                          |
| `event_type`   | string            | See event catalog        |
| `payload`      | object            | Canonical JSON           |
| `signature`    | HMAC-SHA256       | Secret from world config |
| `delivered_at` | virtual timestamp |                          |

## Event catalog (v0.1)

| Event              | Trigger                            | Webhook |
| ------------------ | ---------------------------------- | ------- |
| `account.created`  | World bootstrap / bulk open        | yes     |
| `transfer.created` | Inject or API                      | yes     |
| `transfer.settled` | Settlement batch or instant        | yes     |
| `compliance.flag`  | risk_score > threshold on transfer | yes     |

## Rules engine

1. **Transfer creation** — Debit `from` (increase hold), credit pending ledger entry.
2. **Idempotency** — Same `idempotency_key` + same params ⇒ return existing transfer, no double debit.
3. **Insufficient funds** — `balance_cents - hold_cents < amount` ⇒ `failed` transfer, `compliance.flag` optional.
4. **KYC limits** — Tier 0 max single transfer 10_000 cents; tier 3 unlimited in v0.1.
5. **Settlement** — `terrarium advance` crossing batch boundary settles pending transfers with `settled_at = now`.

## Baseline scenario (`scenarios/fintech/baseline.yaml`)

- Seed: `42`
- 50 users, 50 accounts (1:1)
- Initial balance: 100_000 cents each
- Webhook sink: `.terrarium/webhooks.jsonl`
- No scheduled injections (clean slate for manual inject)

## Inject commands (CLI)

```bash
terrarium inject transfer \
  --from acct_0001 --to acct_0002 \
  --amount 25000 --currency USD \
  --idempotency-key demo-1

terrarium inject account.open --count 10
```

## State hash

World exports `state_hash` = SHA-256 of canonical JSON:

```json
{
  "clock": "2024-01-15T12:00:00.000Z",
  "accounts": [...],
  "transfers": [...],
  "webhook_count": 12
}
```

Used for determinism CI and replay verification.

## Extension points (community)

- `FintechVertical.registerHook('pre_transfer', fn)` — middleware chain
- Custom compliance rules via scenario `spec.rules[]`
- External API shape adapters (Plaid-like, Stripe-like) — v0.2

## Non-goals (v0.1)

- Real payment rails (ACH, card networks)
- Multi-currency FX
- Persistent HTTP server (CLI + SDK only; gateway is v0.2)
