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
      allowAdjacentTouch: true,
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
  registerResource,
  checkConflicts,
  bookResources,
  releaseResources,
  __resetResourceConflictStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('resource-conflict-engine', () => {
  beforeEach(() => {
    __resetResourceConflictStore();
    vi.clearAllMocks();
  });

  it('books staff + room without conflict', async () => {
    const staff = await registerResource(tenantId, actorId, {
      kind: 'staff',
      name: 'Alex',
    });
    const room = await registerResource(tenantId, actorId, {
      kind: 'room',
      name: 'Bay 1',
    });
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 86_400_000 + 3600_000).toISOString();
    const check = await checkConflicts(tenantId, actorId, {
      resourceIds: [staff.id, room.id],
      startAt: start,
      endAt: end,
    });
    expect(check.ok).toBe(true);
    const booked = await bookResources(tenantId, actorId, {
      appointmentId: crypto.randomUUID(),
      resourceIds: [staff.id, room.id],
      startAt: start,
      endAt: end,
    });
    expect(booked).toHaveLength(2);
  });

  it('detects double-book on same resource', async () => {
    const staff = await registerResource(tenantId, actorId, {
      kind: 'staff',
      name: 'Blake',
    });
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000 + 3600_000).toISOString();
    await bookResources(tenantId, actorId, {
      appointmentId: 'appt-1',
      resourceIds: [staff.id],
      startAt: start,
      endAt: end,
    });
    const check = await checkConflicts(tenantId, actorId, {
      resourceIds: [staff.id],
      startAt: start,
      endAt: end,
    });
    expect(check.ok).toBe(false);
    await expect(
      bookResources(tenantId, actorId, {
        appointmentId: 'appt-2',
        resourceIds: [staff.id],
        startAt: start,
        endAt: end,
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('releases resources and allows rebook', async () => {
    const room = await registerResource(tenantId, actorId, {
      kind: 'room',
      name: 'Studio',
    });
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 3 * 86_400_000 + 1800_000).toISOString();
    await bookResources(tenantId, actorId, {
      appointmentId: 'appt-x',
      resourceIds: [room.id],
      startAt: start,
      endAt: end,
    });
    const rel = await releaseResources(tenantId, actorId, 'appt-x');
    expect(rel.released).toBe(1);
    const booked = await bookResources(tenantId, actorId, {
      appointmentId: 'appt-y',
      resourceIds: [room.id],
      startAt: start,
      endAt: end,
    });
    expect(booked).toHaveLength(1);
  });
});
