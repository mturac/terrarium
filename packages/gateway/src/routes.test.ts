import { describe, expect, it } from 'vitest';
import { mapStripeTransferToInject } from './routes.js';

describe('mapStripeTransferToInject', () => {
  it('omits idempotency_key so fintech uses auto- prefix like CLI', () => {
    const args = mapStripeTransferToInject({
      amount: 25000,
      source: 'acct_0001',
      destination: 'acct_0002',
    });
    expect(args.idempotency_key).toBeUndefined();
    expect(args.from).toBe('acct_0001');
    expect(args.to).toBe('acct_0002');
    expect(args.amount).toBe(25000);
  });

  it('passes explicit idempotency_key when provided', () => {
    const args = mapStripeTransferToInject({
      amount: 100,
      source: 'a',
      destination: 'b',
      idempotency_key: 'custom-key',
    });
    expect(args.idempotency_key).toBe('custom-key');
  });
});
