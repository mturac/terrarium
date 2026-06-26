import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hmacSign } from '@terrarium/core';
import type { EventEnvelope, Vertical, VerticalContext } from '@terrarium/core';
import { generateAccounts, generateUsers } from './generator.js';
import type { Account, FintechState, Transfer, WebhookDelivery } from './types.js';

const KYC_LIMITS_CENTS: Record<number, number> = {
  0: 1_000_000,
  1: 5_000_000,
  2: 25_000_000,
  3: Number.MAX_SAFE_INTEGER,
};

export class FintechVertical implements Vertical {
  readonly name = 'fintech';
  private state: FintechState = emptyState();

  bootstrap(ctx: VerticalContext): void {
    const population = ctx.scenario.population;
    const currency = ctx.scenario.currency ?? 'USD';
    const initial = ctx.scenario.initial_balance_cents ?? 100_000;
    const users = generateUsers(ctx.seed, population);
    const accounts = generateAccounts(users, currency, initial);

    this.state = {
      users,
      accounts,
      transfers: [],
      idempotency_index: {},
      webhooks: [],
      webhook_secret: `whsec_${ctx.seed}`,
    };

    for (const account of accounts) {
      const owner = users.find((u) => u.id === account.owner_id);
      ctx.emit('account.created', {
        account_id: account.id,
        owner_id: account.owner_id,
        currency: account.currency,
        balance_cents: account.balance_cents,
        kyc_tier: account.kyc_tier,
      });
      this.deliverWebhook(ctx, 'account.created', {
        account_id: account.id,
        owner: owner?.display_name,
        email: owner?.email,
      });
    }
  }

  inject(action: string, args: Record<string, unknown>, ctx: VerticalContext): EventEnvelope[] {
    switch (action) {
      case 'transfer':
        return [this.injectTransfer(args, ctx)];
      case 'account.open':
        return this.injectAccountOpen(args, ctx);
      default:
        throw new Error(`Unknown fintech inject action: ${action}`);
    }
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  restoreState(state: Record<string, unknown>): void {
    this.state = state as unknown as FintechState;
  }

  settlePending(ctx: VerticalContext): EventEnvelope[] {
    const envelopes: EventEnvelope[] = [];
    for (const transfer of this.state.transfers) {
      if (transfer.status !== 'pending') continue;
      this.commitTransfer(transfer, ctx);
      envelopes.push(
        ctx.emit('transfer.settled', {
          transfer_id: transfer.id,
          settled_at_tick: transfer.settled_at_tick,
        }),
      );
      this.deliverWebhook(ctx, 'transfer.settled', {
        transfer_id: transfer.id,
        amount_cents: transfer.amount_cents,
        currency: transfer.currency,
      });
    }
    return envelopes;
  }

  private injectTransfer(args: Record<string, unknown>, ctx: VerticalContext): EventEnvelope {
    const from = String(args.from ?? args.from_account_id ?? '');
    const to = String(args.to ?? args.to_account_id ?? '');
    const amount = Number(args.amount ?? args.amount_cents ?? 0);
    const currency = String(args.currency ?? 'USD');
    const idempotencyKey = String(args.idempotency_key ?? args['idempotency-key'] ?? `auto-${from}-${to}-${amount}`);

    const existingId = this.state.idempotency_index[idempotencyKey];
    if (existingId) {
      const existing = this.state.transfers.find((t) => t.id === existingId);
      if (existing) {
        return ctx.emit('transfer.created', { transfer_id: existing.id, duplicate: true });
      }
    }

    const fromAcct = this.requireAccount(from);
    const toAcct = this.requireAccount(to);

    if (fromAcct.currency !== currency || toAcct.currency !== currency) {
      throw new Error('Currency mismatch');
    }

    const transfer: Transfer = {
      id: `txn_${String(this.state.transfers.length + 1).padStart(6, '0')}`,
      idempotency_key: idempotencyKey,
      from_account_id: from,
      to_account_id: to,
      amount_cents: amount,
      currency,
      status: 'pending',
      created_at_tick: ctx.clock.getTick(),
      settled_at_tick: null,
    };

    const available = fromAcct.balance_cents - fromAcct.hold_cents;
    const limit = KYC_LIMITS_CENTS[fromAcct.kyc_tier] ?? 10_000;

    if (amount <= 0) {
      transfer.status = 'failed';
    } else if (amount > available) {
      transfer.status = 'failed';
      this.flagCompliance(ctx, fromAcct, transfer, 'insufficient_funds');
    } else if (amount > limit) {
      transfer.status = 'failed';
      this.flagCompliance(ctx, fromAcct, transfer, 'kyc_limit_exceeded');
    } else {
      fromAcct.hold_cents += amount;
    }

    this.state.transfers.push(transfer);
    this.state.idempotency_index[idempotencyKey] = transfer.id;

    const envelope = ctx.emit('transfer.created', {
      transfer_id: transfer.id,
      from_account_id: from,
      to_account_id: to,
      amount_cents: amount,
      status: transfer.status,
    });

    this.deliverWebhook(ctx, 'transfer.created', {
      transfer_id: transfer.id,
      status: transfer.status,
      amount_cents: amount,
    });

    if (transfer.status === 'pending') {
      this.commitTransfer(transfer, ctx);
      ctx.emit('transfer.settled', { transfer_id: transfer.id });
      this.deliverWebhook(ctx, 'transfer.settled', {
        transfer_id: transfer.id,
        amount_cents: amount,
      });
    }

    return envelope;
  }

  private injectAccountOpen(args: Record<string, unknown>, ctx: VerticalContext): EventEnvelope[] {
    const count = Number(args.count ?? 1);
    const envelopes: EventEnvelope[] = [];
    const start = this.state.users.length;
    const newUsers = generateUsers(ctx.seed + start, count);
    const currency = ctx.scenario.currency ?? 'USD';
    const initial = ctx.scenario.initial_balance_cents ?? 100_000;

    for (let i = 0; i < newUsers.length; i++) {
      const user = newUsers[i]!;
      user.id = `user_${String(start + i + 1).padStart(4, '0')}`;
      user.email = `${user.id}@terrarium.local`;
      this.state.users.push(user);
      const account: Account = {
        id: `acct_${String(this.state.accounts.length + 1).padStart(4, '0')}`,
        owner_id: user.id,
        currency,
        balance_cents: initial,
        hold_cents: 0,
        kyc_tier: 0,
        status: 'active',
      };
      this.state.accounts.push(account);
      envelopes.push(
        ctx.emit('account.created', { account_id: account.id, owner_id: user.id }),
      );
      this.deliverWebhook(ctx, 'account.created', { account_id: account.id });
    }
    return envelopes;
  }

  private commitTransfer(transfer: Transfer, ctx: VerticalContext): void {
    if (transfer.status !== 'pending') return;
    const from = this.requireAccount(transfer.from_account_id);
    const to = this.requireAccount(transfer.to_account_id);
    from.hold_cents -= transfer.amount_cents;
    from.balance_cents -= transfer.amount_cents;
    to.balance_cents += transfer.amount_cents;
    transfer.status = 'settled';
    transfer.settled_at_tick = ctx.clock.getTick();
  }

  private requireAccount(id: string): Account {
    const acct = this.state.accounts.find((a) => a.id === id);
    if (!acct) throw new Error(`Account not found: ${id}`);
    return acct;
  }

  private flagCompliance(
    ctx: VerticalContext,
    account: Account,
    transfer: Transfer,
    reason: string,
  ): void {
    const owner = this.state.users.find((u) => u.id === account.owner_id);
    if ((owner?.risk_score ?? 0) < 0.7 && reason === 'insufficient_funds') return;
    ctx.emit('compliance.flag', {
      account_id: account.id,
      transfer_id: transfer.id,
      reason,
    });
    this.deliverWebhook(ctx, 'compliance.flag', {
      account_id: account.id,
      transfer_id: transfer.id,
      reason,
    });
  }

  private deliverWebhook(
    ctx: VerticalContext,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    const body = JSON.stringify({ type: eventType, data: payload });
    const delivery: WebhookDelivery = {
      id: `wh_${String(this.state.webhooks.length + 1).padStart(6, '0')}`,
      event_type: eventType,
      payload: { type: eventType, data: payload },
      signature: hmacSign(body, this.state.webhook_secret),
      delivered_at_tick: ctx.clock.getTick(),
    };
    this.state.webhooks.push(delivery);

    const sink = ctx.scenario.webhook_sink;
    if (sink) {
      const path = join(ctx.cwd, sink);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(delivery)}\n`);
    }
  }
}

function emptyState(): FintechState {
  return {
    users: [],
    accounts: [],
    transfers: [],
    idempotency_index: {},
    webhooks: [],
    webhook_secret: 'whsec_uninitialized',
  };
}

export function createFintechVertical(): FintechVertical {
  return new FintechVertical();
}