import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      conditions: {
        product: 'stock > 0',
        slot: 'status == available',
      },
      maxSubscriptionsPerUser: 50,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  subscribe,
  signalAvailable,
  listSubscriptions,
  listNotifications,
  evaluateCondition,
  setNotifyFn,
  __resetNotifyWhenAvailableStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('notify-when-available', () => {
  beforeEach(() => {
    __resetNotifyWhenAvailableStore();
    vi.clearAllMocks();
  });

  it('evaluateCondition helpers', () => {
    expect(evaluateCondition('stock > 0', { stock: 5 })).toBe(true);
    expect(evaluateCondition('stock > 0', { stock: 0 })).toBe(false);
    expect(
      evaluateCondition('status == available', { status: 'available' }),
    ).toBe(true);
  });

  it('notifies once then clears subscription', async () => {
    const sent: string[] = [];
    setNotifyFn(async (e) => {
      sent.push(e.userId);
    });

    await subscribe(tenantId, actorId, {
      userId: 'u1',
      entityType: 'product',
      entityId: 'sku-9',
    });
    await subscribe(tenantId, actorId, {
      userId: 'u2',
      entityType: 'product',
      entityId: 'sku-9',
    });
    expect((await listSubscriptions(tenantId, 'u1')).length).toBe(1);

    // not yet available
    const none = await signalAvailable(tenantId, actorId, {
      entityType: 'product',
      entityId: 'sku-9',
      context: { stock: 0 },
    });
    expect(none.notified).toBe(0);

    const fired = await signalAvailable(tenantId, actorId, {
      entityType: 'product',
      entityId: 'sku-9',
      context: { stock: 3 },
    });
    expect(fired.notified).toBe(2);
    expect(sent.sort()).toEqual(['u1', 'u2']);
    expect((await listSubscriptions(tenantId, 'u1')).length).toBe(0);
    expect((await listNotifications(tenantId, 'u1')).length).toBe(1);

    // second signal — no remaining subs
    const again = await signalAvailable(tenantId, actorId, {
      entityType: 'product',
      entityId: 'sku-9',
      context: { stock: 10 },
    });
    expect(again.notified).toBe(0);
  });

  it('idempotent subscribe', async () => {
    const a = await subscribe(tenantId, actorId, {
      userId: 'u1',
      entityType: 'slot',
      entityId: 's1',
    });
    const b = await subscribe(tenantId, actorId, {
      userId: 'u1',
      entityType: 'slot',
      entityId: 's1',
    });
    expect(a.id).toBe(b.id);
  });
});
