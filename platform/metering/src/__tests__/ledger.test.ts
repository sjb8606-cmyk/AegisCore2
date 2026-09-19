import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { recordUsage } from '../ledger';
import { loadConfig } from '@platform/utils';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const BASE_CONFIG = {
  eventTypes: ['api_call', 'llm_token_input'],
  defaultUnit: 'count',
  billingEnabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue(BASE_CONFIG);
});

describe('recordUsage — real ledger persistence', () => {
  it('actually writes to usage_events for a valid event type (the core bug this fixes)', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: 'row-1' }]);

    await recordUsage({
      tenantId: TENANT_ID,
      eventType: 'api_call',
      quantity: 1,
      idempotencyKey: 'test:1',
    });

    expect(withTenantQuery).toHaveBeenCalledTimes(1);
    const [sql, params, tenantIdArg] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('INSERT INTO usage_events');
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(params).toContain(TENANT_ID);
    expect(params).toContain('api_call');
    expect(params).toContain(1);
    expect(tenantIdArg).toBe(TENANT_ID);
  });

  it('does not write when eventType is not in the config manifest', async () => {
    await recordUsage({
      tenantId: TENANT_ID,
      eventType: 'not_a_real_event',
      quantity: 1,
      idempotencyKey: 'test:2',
    });

    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('does not write when billing is disabled', async () => {
    (loadConfig as any).mockReturnValue({ ...BASE_CONFIG, billingEnabled: false });

    await recordUsage({
      tenantId: TENANT_ID,
      eventType: 'api_call',
      quantity: 1,
      idempotencyKey: 'test:3',
    });

    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects non-positive quantity loudly instead of hitting the DB', async () => {
    await expect(
      recordUsage({
        tenantId: TENANT_ID,
        eventType: 'api_call',
        quantity: 0,
        idempotencyKey: 'test:4',
      }),
    ).rejects.toThrow('quantity must be > 0');

    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('treats a duplicate idempotencyKey as a no-op, not an error', async () => {
    (withTenantQuery as any).mockResolvedValue([]); // ON CONFLICT DO NOTHING -> no rows

    await expect(
      recordUsage({
        tenantId: TENANT_ID,
        eventType: 'api_call',
        quantity: 1,
        idempotencyKey: 'test:5',
      }),
    ).resolves.toBeUndefined();
  });
});
