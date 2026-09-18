import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/src/index', () => ({
  loadConfig: vi.fn(),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
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
    (withTenantQuery as any).mockResolvedValueOnce([{ count: 3 }]);
    await expect(createPlan(TENANT_ID, 'Pro', 1999)).rejects.toThrow('Plan limit exceeded for this tier');
  });

  it('creates a plan and returns the inserted row when under the limit', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    const insertedRow = { id: 'plan-1', tenant_id: TENANT_ID, name: 'Pro', price_cents: 1999 };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([insertedRow]);

    const result = await createPlan(TENANT_ID, 'Pro', 1999);
    expect(result).toEqual(insertedRow);
  });
});

describe('createSubscription', () => {
  it('throws when subscriptions are disabled in config', async () => {
    (loadConfig as any).mockReturnValue({ ...enabledConfig, enabled: false });
    await expect(createSubscription(TENANT_ID, USER_ID, PLAN_ID)).rejects.toThrow('Subscriptions disabled');
  });

  it('throws NOT_IMPLEMENTED instead of returning a fake checkout URL', async () => {
    (loadConfig as any).mockReturnValue(enabledConfig);
    const inserted = { id: 'sub-1', tenant_id: TENANT_ID, user_id: USER_ID, plan_id: PLAN_ID, status: 'active' };
    (withTenantQuery as any).mockResolvedValueOnce([inserted]);
    (recordUsage as any).mockResolvedValue(undefined);

    await expect(createSubscription(TENANT_ID, USER_ID, PLAN_ID)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });

    expect(withTenantQuery).toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalled();
  });
});
