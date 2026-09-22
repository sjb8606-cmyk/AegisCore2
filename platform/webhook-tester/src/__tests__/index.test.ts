import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockGetTierConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/entitlements', () => ({
  getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return { ...actual };
});

import { sendTestWebhook, listTestRuns, getTestRun } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-3333-3333-333333333333';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      sendTest: true,
      recordHistory: true,
      customHeaders: true,
      signedPayloads: true,
      ...(over.tiers as object),
    },
    limits: {
      maxHistoryPerTenant: 500,
      maxBodyBytes: 65536,
      defaultTimeoutMs: 10000,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('sendTestWebhook', () => {
  it('sends and records a successful run', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: RUN_ID, success: true, status_code: 200 },
    ]);
    const sender = vi.fn().mockResolvedValue({
      status_code: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      duration_ms: 42,
    });
    const row = await sendTestWebhook(
      TENANT,
      { target_url: 'https://example.com/hook', body: { hello: 'world' } },
      ACTOR,
      sender,
    );
    expect(row.success).toBe(true);
    expect(sender).toHaveBeenCalled();
  });

  it('records failure when sender throws', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: RUN_ID, success: false, error_message: 'timeout' },
    ]);
    const sender = vi.fn().mockRejectedValue(new Error('timeout'));
    const row = await sendTestWebhook(
      TENANT,
      { target_url: 'https://example.com/hook' },
      ACTOR,
      sender,
    );
    expect(row.success).toBe(false);
  });

  it('rejects invalid URL', async () => {
    const sender = vi.fn();
    await expect(
      sendTestWebhook(TENANT, { target_url: 'not-a-url' }, ACTOR, sender),
    ).rejects.toThrow();
  });

  it('requires customHeaders tier', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { customHeaders: false } }));
    const sender = vi.fn();
    await expect(
      sendTestWebhook(
        TENANT,
        { target_url: 'https://example.com/hook', headers: { 'x-test': '1' } },
        ACTOR,
        sender,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    const sender = vi.fn();
    await expect(
      sendTestWebhook(TENANT, { target_url: 'https://example.com/hook' }, ACTOR, sender),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listTestRuns / getTestRun', () => {
  it('lists runs', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: RUN_ID }]);
    const rows = await listTestRuns(TENANT);
    expect(rows).toHaveLength(1);
  });

  it('gets a run', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: RUN_ID }]);
    const row = await getTestRun(TENANT, RUN_ID);
    expect(row.id).toBe(RUN_ID);
  });

  it('throws NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getTestRun(TENANT, RUN_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
