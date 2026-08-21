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
      defaultReliability: 0.7,
      minReliability: 0,
      maxReliability: 1,
    }),
  };
});

vi.mock('@platform/incident-breaker', () => ({
  isActorSuspended: vi.fn().mockReturnValue(false),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createActor,
  updateReliability,
  listActors,
  __resetPlannerActorsStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const adminId = '00000000-0000-4000-8000-0000000000aa';

describe('planner-actors', () => {
  beforeEach(() => {
    __resetPlannerActorsStore();
    vi.clearAllMocks();
  });

  it('creates actor with default reliability', async () => {
    const a = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Alex Foster',
    });
    expect(a.reliabilityScore).toBe(0.7);
    expect(a.active).toBe(true);
  });

  it('updates reliability within bounds', async () => {
    const a = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Alex',
    });
    const updated = await updateReliability(tenantId, 'system', a.id, 0.2);
    expect(updated.reliabilityScore).toBe(0.9);
  });

  it('lists by niche', async () => {
    await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'A',
    });
    await createActor(tenantId, adminId, {
      niche: 'clinic',
      role: 'NURSE',
      displayName: 'B',
    });
    const list = await listActors(tenantId, { niche: 'pet-foster' });
    expect(list).toHaveLength(1);
  });
});
