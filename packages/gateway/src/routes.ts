import { inject, loadPersistedWorld } from '@terrarium/core';
import type { RunningWorld } from '@terrarium/core';

/** Stripe-like transfer create body (subset). */
export interface StripeTransferRequest {
  amount: number;
  currency?: string;
  source: string;
  destination: string;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
}

export interface StripeTransferResponse {
  id: string;
  object: 'transfer';
  amount: number;
  currency: string;
  source: string;
  destination: string;
  status: string;
  state_hash: string;
}

export function mapStripeTransferToInject(body: StripeTransferRequest): Record<string, unknown> {
  return {
    from: body.source,
    to: body.destination,
    amount: body.amount,
    currency: (body.currency ?? 'usd').toUpperCase(),
    idempotency_key: body.idempotency_key ?? `http-${body.source}-${body.destination}-${body.amount}`,
  };
}

export function handleTransferCreate(
  world: RunningWorld,
  body: StripeTransferRequest,
  cwd: string,
): StripeTransferResponse {
  const args = mapStripeTransferToInject(body);
  inject(world, 'transfer', args, cwd);

  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('World not persisted after inject');

  const state = persisted.vertical_state as {
    transfers: { id: string; status: string }[];
  };
  const transfer = state.transfers.at(-1);
  if (!transfer) throw new Error('Transfer not created');

  return {
    id: transfer.id,
    object: 'transfer',
    amount: body.amount,
    currency: (body.currency ?? 'usd').toLowerCase(),
    source: body.source,
    destination: body.destination,
    status: transfer.status,
    state_hash: persisted.meta.state_hash,
  };
}