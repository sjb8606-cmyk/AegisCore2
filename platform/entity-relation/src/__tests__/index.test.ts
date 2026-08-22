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
      cascadeOnParentDelete: 'block',
      maxChildrenPerParent: 1000,
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
  createParent,
  createChild,
  listChildren,
  deleteParent,
  deleteChild,
  __resetEntityRelationStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('entity-relation', () => {
  beforeEach(() => {
    __resetEntityRelationStore();
    vi.clearAllMocks();
  });

  it('creates parent and children', async () => {
    const parent = await createParent(tenantId, actorId, {
      type: 'customer',
      name: 'Acme HVAC',
    });
    await createChild(tenantId, actorId, {
      parentId: parent.id,
      type: 'equipment',
      name: 'Rooftop Unit 1',
      attributes: { model: 'RTU-200' },
    });
    await createChild(tenantId, actorId, {
      parentId: parent.id,
      type: 'equipment',
      name: 'Boiler A',
    });
    const kids = await listChildren(tenantId, parent.id, 'equipment');
    expect(kids).toHaveLength(2);
  });

  it('blocks parent delete when children exist', async () => {
    const parent = await createParent(tenantId, actorId, {
      type: 'site',
      name: 'Dock 3',
    });
    await createChild(tenantId, actorId, {
      parentId: parent.id,
      type: 'asset',
      name: 'Crane',
    });
    await expect(
      deleteParent(tenantId, actorId, parent.id),
    ).rejects.toThrow(/blocked/i);
  });

  it('deletes child then parent', async () => {
    const parent = await createParent(tenantId, actorId, {
      type: 'farm',
      name: 'North Field Farm',
    });
    const child = await createChild(tenantId, actorId, {
      parentId: parent.id,
      type: 'field',
      name: 'Plot A',
    });
    await deleteChild(tenantId, actorId, child.id);
    const result = await deleteParent(tenantId, actorId, parent.id);
    expect(result.deleted).toBe(true);
  });
});
