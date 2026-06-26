import type { Account, SyntheticUser } from './types.js';

const FIRST_NAMES = ['Ada', 'Grace', 'Alan', 'Katherine', 'Dennis', 'Barbara', 'Donald', 'Margaret'];
const LAST_NAMES = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Ritchie', 'Liskov', 'Knuth', 'Hamilton'];

export function generateUsers(seed: number, count: number): SyntheticUser[] {
  const users: SyntheticUser[] = [];
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(seed + i * 9973);
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
    const id = `user_${String(i + 1).padStart(4, '0')}`;
    users.push({
      id,
      display_name: `${first} ${last}`,
      email: `${id}@terrarium.local`,
      risk_score: Math.round(rng() * 100) / 100,
    });
  }
  return users;
}

export function generateAccounts(
  users: SyntheticUser[],
  currency: string,
  initialBalanceCents: number,
): Account[] {
  return users.map((user, i) => ({
    id: `acct_${String(i + 1).padStart(4, '0')}`,
    owner_id: user.id,
    currency,
    balance_cents: initialBalanceCents,
    hold_cents: 0,
    kyc_tier: i % 4,
    status: 'active' as const,
  }));
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}