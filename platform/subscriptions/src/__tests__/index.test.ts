import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/src/index', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { createPlan, createSubscription } from '../index';
import { loadConfig } from '../../../utils/src/index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { recordUsage } from '../../../metering/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PLAN_ID = '33333333-3333-3333-3333-333333333333';

const enabledConfig = {
  enabled: true,
  limits: { planCount: 3, trialDays: 14 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createPlan', () => {
  it('throws when subscriptions are disabled in config', async () => {
    (loadConfig as any).mockReturnValue({ ...enabledConfig, enabled: false });
    await expect(createPlan(TENANT_ID, 'Pro', 1999)).rejects.toThrow('Subscriptions disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws when the tenant has hit its plan limit', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    (withTenantQuery as any).mockResolvedValueOnce([{ count: 3 }]); // == limits.planCount
    await expect(createPlan(TENANT_ID, 'Pro', 1999)).rejects.toThrow('Plan limit exceeded for this tier');
  });

  it('creates a plan and returns the inserted row when under the limit', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    const insertedRow = { id: 'plan-1', tenant_id: TENANT_ID, name: 'Pro', price_cents: 1999 };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: 1 }])       // COUNT check
      .mockResolvedValueOnce([insertedRow]);        // INSERT ... RETURNING

    const result = await createPlan(TENANT_ID, 'Pro', 1999);

    expect(result).toEqual(insertedRow);
    expect(withTenantQuery).toHaveBeenCalledTimes(2);
    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1]).toEqual(expect.arrayContaining([TENANT_ID, 'Pro', 1999]));
  });
});

describe('createSubscription', () => {
  it('throws when subscriptions are disabled in config', async () => {
    (loadConfig as any).mockReturnValue({ ...enabledConfig, enabled: false });
    await expect(createSubscription(TENANT_ID, USER_ID, PLAN_ID)).rejects.toThrow('Subscriptions disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('inserts an active subscription row and records usage for billing', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    const insertedRow = { id: 'sub-1', tenant_id: TENANT_ID, user_id: USER_ID, plan_id: PLAN_ID, status: 'active' };
    (withTenantQuery as any).mockResolvedValueOnce([insertedRow]);

    const result = await createSubscription(TENANT_ID, USER_ID, PLAN_ID);

    expect(result.subscriptionId).toBe('sub-1');
    expect(result.status).toBe('active');
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        eventType: 'api_call',
        idempotencyKey: 'sub:sub-1',
      })
    );
  });

  // KNOWN DEFECT — not a false-negative in this test, a documented gap.
  // createSubscription() returns a hardcoded fake URL instead of calling a real
  // payment provider (contrast with platform/payments' PaymentDriverRegistry
  // pattern for Stripe/PayPal/Crypto). This test locks in the *current* broken
  // behavior so it fails loudly the moment someone wires up a real checkout flow,
  // which is what should happen before this ships.
  it('DEFECT: currently returns a hardcoded mock checkout URL, not a real one', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'sub-2', status: 'active' }]);

    const result = await createSubscription(TENANT_ID, USER_ID, PLAN_ID);

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/mock_session_sub-2');
    // TODO(delight-engine launch blocker): replace with real provider-driven checkout session.
  });
});
