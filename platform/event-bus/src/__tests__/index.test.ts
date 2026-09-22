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

import { subscribe, listSubscriptions, publish, listEvents, listDeadLetters } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      publish: true,
      subscribe: true,
      replay: true,
      deadLetter: true,
      ...(over.tiers as object),
    },
    limits: {
      maxSubscriptionsPerTenant: 100,
      maxPayloadBytes: 65536,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('subscribe', () => {
  it('creates a subscription', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'sub-1', topic: 'order.created' }]);
    const row = await subscribe(TENANT, {
      topic: 'order.created', handler_key: 'notify.email',
    }, ACTOR);
    expect(row.topic).toBe('order.created');
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      subscribe(TENANT, { topic: 'x', handler_key: 'y' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('publish', () => {
  it('publishes and delivers to subscribers', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: 'evt-1', topic: 'order.created' }]) // log
      .mockResolvedValueOnce([
        { handler_key: 'notify.email' },
        { handler_key: 'notify.sms' },
      ]);
    const dispatcher = vi.fn().mockResolvedValue(undefined);
    const result = await publish(
      TENANT,
      { topic: 'order.created', payload: { id: 1 } },
      ACTOR,
      dispatcher,
    );
    expect(result.delivered).toBe(2);
    expect(result.failures).toHaveLength(0);
    expect(dispatcher).toHaveBeenCalledTimes(2);
  });

  it('records dead letters on handler failure', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: 'evt-2', topic: 'order.created' }])
      .mockResolvedValueOnce([{ handler_key: 'bad.handler' }])
      .mockResolvedValueOnce([]); // dlq insert
    const dispatcher = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await publish(
      TENANT,
      { topic: 'order.created', payload: {} },
      ACTOR,
      dispatcher,
    );
    expect(result.delivered).toBe(0);
    expect(result.failures).toHaveLength(1);
  });

  it('rejects invalid tenant', async () => {
    const dispatcher = vi.fn();
    await expect(
      publish('bad', { topic: 'x', payload: {} }, ACTOR, dispatcher),
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid tenant/i) });
  });
});

describe('listSubscriptions / listEvents / listDeadLetters', () => {
  it('lists subscriptions', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'sub-1' }]);
    const rows = await listSubscriptions(TENANT);
    expect(rows).toHaveLength(1);
  });

  it('lists events', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'evt-1' }]);
    const rows = await listEvents(TENANT);
    expect(rows).toHaveLength(1);
  });

  it('lists dead letters', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'dlq-1' }]);
    const rows = await listDeadLetters(TENANT);
    expect(rows).toHaveLength(1);
  });

  it('requires replay tier for listEvents', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { replay: false } }));
    await expect(listEvents(TENANT)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
