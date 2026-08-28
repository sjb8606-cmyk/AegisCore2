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
      maxQueueDepth: 5000,
      maxAttempts: 5,
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
  enqueueEvent,
  replayQueue,
  getQueueStatus,
  setEventProcessor,
  __resetOfflineQueueStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const deviceId = 'pos-terminal-1';

describe('offline-queue-replay', () => {
  beforeEach(() => {
    __resetOfflineQueueStore();
    vi.clearAllMocks();
    setEventProcessor(async () => undefined);
  });

  it('enqueues and replays successfully', async () => {
    const applied: string[] = [];
    setEventProcessor(async (_t, eventType) => {
      applied.push(eventType);
    });
    await enqueueEvent(tenantId, actorId, {
      deviceId,
      idempotencyKey: 'sale-1',
      eventType: 'sale',
      payload: { total: 1000 },
    });
    const result = await replayQueue(tenantId, actorId, deviceId);
    expect(result.completed).toBe(1);
    expect(applied).toEqual(['sale']);
    const status = await getQueueStatus(tenantId, actorId, deviceId);
    expect(status.completed).toBe(1);
  });

  it('dedupes by idempotency key', async () => {
    const a = await enqueueEvent(tenantId, actorId, {
      deviceId,
      idempotencyKey: 'sale-2',
      eventType: 'sale',
      payload: {},
    });
    const b = await enqueueEvent(tenantId, actorId, {
      deviceId,
      idempotencyKey: 'sale-2',
      eventType: 'sale',
      payload: {},
    });
    expect(b.status).toBe('duplicate');
    expect(b.id).toBe(a.id);
  });

  it('marks failed after processor errors exhaust attempts', async () => {
    setEventProcessor(async () => {
      throw new Error('boom');
    });
    // lower maxAttempts via sequential failures — config is 5; force fail status by replaying enough
    await enqueueEvent(tenantId, actorId, {
      deviceId,
      idempotencyKey: 'bad-1',
      eventType: 'sale',
      payload: {},
    });
    for (let i = 0; i < 5; i++) {
      await replayQueue(tenantId, actorId, deviceId);
    }
    const status = await getQueueStatus(tenantId, actorId, deviceId);
    expect(status.failed).toBe(1);
  });
});
