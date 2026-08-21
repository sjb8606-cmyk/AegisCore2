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
      niche: 'pet-foster',
      entityLabel: 'animal',
      customFields: [{ name: 'species', type: 'string' }],
      tagVocabulary: ['noise-sensitive', 'kid-safe', 'senior'],
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
  createEntity,
  updateEntity,
  listEntities,
  __resetPlannerEntitiesStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('planner-entities', () => {
  beforeEach(() => {
    __resetPlannerEntitiesStore();
    vi.clearAllMocks();
  });

  it('creates entity with tags', async () => {
    const e = await createEntity(tenantId, actorId, {
      name: 'Max',
      tags: ['kid-safe'],
      customFields: { species: 'dog' },
    });
    expect(e.name).toBe('Max');
    expect(e.status).toBe('available');
  });

  it('rejects unknown tags', async () => {
    try {
      await createEntity(tenantId, actorId, {
        name: 'Max',
        tags: ['alien'],
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/vocabulary|tag/i);
    }
  });

  it('updates status', async () => {
    const e = await createEntity(tenantId, actorId, { name: 'Luna' });
    const updated = await updateEntity(tenantId, actorId, e.id, {
      status: 'assigned',
    });
    expect(updated.status).toBe('assigned');
  });

  it('lists by tag', async () => {
    await createEntity(tenantId, actorId, {
      name: 'A',
      tags: ['senior'],
    });
    await createEntity(tenantId, actorId, {
      name: 'B',
      tags: ['kid-safe'],
    });
    const list = await listEntities(tenantId, { tag: 'senior' });
    expect(list).toHaveLength(1);
  });
});
