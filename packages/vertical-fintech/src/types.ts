export interface SyntheticUser {
  id: string;
  display_name: string;
  email: string;
  risk_score: number;
}

export interface Account {
  id: string;
  owner_id: string;
  currency: string;
  balance_cents: number;
  hold_cents: number;
  kyc_tier: number;
  status: 'active' | 'frozen' | 'closed';
}

export interface Transfer {
  id: string;
  idempotency_key: string;
  from_account_id: string;
  to_account_id: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'settled' | 'failed';
  created_at_tick: number;
  settled_at_tick: number | null;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  signature: string;
  delivered_at_tick: number;
}

export interface FintechState {
  users: SyntheticUser[];
  accounts: Account[];
  transfers: Transfer[];
  idempotency_index: Record<string, string>;
  webhooks: WebhookDelivery[];
  webhook_secret: string;
}