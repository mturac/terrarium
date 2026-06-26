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

/** Stripe-shaped list envelope for community integrators. */
export interface StripeTransferListResponse {
  object: 'list';
  data: StripeTransferResponse[];
  has_more: boolean;
  url: '/v1/transfers';
}

export function mapStripeTransferToInject(body: StripeTransferRequest): Record<string, unknown> {
  const args: Record<string, unknown> = {
    from: body.source,
    to: body.destination,
    amount: body.amount,
    currency: (body.currency ?? 'usd').toUpperCase(),
  };
  if (body.idempotency_key) {
    args.idempotency_key = body.idempotency_key;
  }
  return args;
}

type PersistedTransfer = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount_cents: number;
  currency: string;
  status: string;
};

export function handleTransferCreate(
  world: RunningWorld,
  body: StripeTransferRequest,
  cwd: string,
): StripeTransferResponse {
  const args = mapStripeTransferToInject(body);
  inject(world, 'transfer', args, cwd);

  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('World not persisted after inject');

  const state = persisted.vertical_state as { transfers: PersistedTransfer[] };
  const transfer = state.transfers.at(-1);
  if (!transfer) throw new Error('Transfer not created');

  return transferToResponse(transfer, persisted.meta.state_hash);
}

export function handleTransferRetrieve(cwd: string, transferId: string): StripeTransferResponse {
  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('No running world');

  const state = persisted.vertical_state as { transfers: PersistedTransfer[] };
  const transfer = state.transfers.find((t) => t.id === transferId);
  if (!transfer) throw new Error(`Transfer not found: ${transferId}`);

  return transferToResponse(transfer, persisted.meta.state_hash);
}

export function handleTransferList(cwd: string): StripeTransferListResponse {
  const persisted = loadPersistedWorld(cwd);
  if (!persisted) throw new Error('No running world');

  const state = persisted.vertical_state as { transfers: PersistedTransfer[] };
  const hash = persisted.meta.state_hash;
  return {
    object: 'list',
    data: state.transfers.map((t) => transferToResponse(t, hash)),
    has_more: false,
    url: '/v1/transfers',
  };
}

function transferToResponse(
  transfer: PersistedTransfer,
  stateHash: string,
): StripeTransferResponse {
  return {
    id: transfer.id,
    object: 'transfer',
    amount: transfer.amount_cents,
    currency: transfer.currency.toLowerCase(),
    source: transfer.from_account_id,
    destination: transfer.to_account_id,
    status: transfer.status,
    state_hash: stateHash,
  };
}
