import { describe, expect, it, beforeEach } from 'vitest';
import {
  holdDeposit,
  assessReturnCondition,
  calculateRefund,
  getDeposit,
  __resetDamageDepositStore
} from '../index';

describe('damage-deposit-tracking', () => {
  beforeEach(() => {
    __resetDamageDepositStore();
  });

  it('holds a deposit for a reservation', async () => {
    const deposit = await holdDeposit(
      'tenant-a',
      'actor-a',
      'reservation-1',
      250,
      'Good condition'
    );

    expect(deposit.reservation_id).toBe('reservation-1');
    expect(deposit.deposit_amount).toBe(250);
    expect(deposit.status).toBe('held');
  });

  it('caps damage cost at the deposit amount', async () => {
    const deposit = await holdDeposit(
      'tenant-a',
      'actor-a',
      'reservation-2',
      250,
      'Good condition'
    );

    const assessed = await assessReturnCondition(
      'tenant-a',
      'actor-a',
      deposit.deposit_id,
      'Severely damaged',
      400
    );

    expect(assessed.damage_cost).toBe(250);
    expect(assessed.damage_assessed).toBe(true);
  });

  it('prevents another tenant from reading the deposit', async () => {
    const deposit = await holdDeposit(
      'tenant-a',
      'actor-a',
      'reservation-3',
      100,
      'Good condition'
    );

    await expect(
      getDeposit('tenant-b', 'actor-b', deposit.deposit_id)
    ).rejects.toThrow('Damage deposit not found');
  });
});
