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
      conflictStrategy: 'last_write_wins',
      maxRetries: 5,
      offlineEntities: ['*'],
      retryBackoffMs: 1000,
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
  enqueueWrite,
  syncPending,
  listPending,
  getServerEntity,
  seedServerEntity,
  __resetOfflineSyncStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('offline-sync-queue', () => {
  beforeEach(() => {
    __resetOfflineSyncStore();
    vi.clearAllMocks();
  });

  it('enqueues and syncs a write', async () => {
    await enqueueWrite(tenantId, actorId, {
      clientId: 'device-1',
      entity: 'catch_log',
      entityId: 'log-1',
      payload: { species: 'cod', kg: 10 },
      idempotencyKey: 'idem-1',
    });
    expect((await listPending(tenantId)).length).toBe(1);

    const result = await syncPending(tenantId, actorId, {
      clientId: 'device-1',
    });
    expect(result.synced).toBe(1);
    expect((await listPending(tenantId)).length).toBe(0);

    const entity = await getServerEntity(tenantId, 'catch_log', 'log-1');
    expect(entity?.data.species).toBe('cod');
  });

  it('idempotent enqueue returns same write', async () => {
    const a = await enqueueWrite(tenantId, actorId, {
      clientId: 'device-1',
      entity: 'note',
      entityId: 'n1',
      payload: { text: 'a' },
      idempotencyKey: 'same-key',
    });
    const b = await enqueueWrite(tenantId, actorId, {
      clientId: 'device-1',
      entity: 'note',
      entityId: 'n1',
      payload: { text: 'b' },
      idempotencyKey: 'same-key',
    });
    expect(a.id).toBe(b.id);
    expect(a.payload.text).toBe('a');
  });

  it('last_write_wins keeps newer client timestamp', async () => {
    await seedServerEntity(
      tenantId,
      'job',
      'j1',
      { status: 'open' },
      '2026-01-01T00:00:00Z',
    );
    await enqueueWrite(tenantId, actorId, {
      clientId: 'device-1',
      entity: 'job',
      entityId: 'j1',
      payload: { status: 'done' },
      idempotencyKey: 'idem-2',
      clientTimestamp: '2026-06-01T00:00:00Z',
    });
    await syncPending(tenantId, actorId);
    const entity = await getServerEntity(tenantId, 'job', 'j1');
    expect(entity?.data.status).toBe('done');
  });
});
