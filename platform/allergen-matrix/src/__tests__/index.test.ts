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
      conflictMode: 'block',
      knownAllergens: [
        'milk',
        'eggs',
        'fish',
        'shellfish',
        'tree_nuts',
        'peanuts',
        'wheat',
        'soy',
        'sesame',
      ],
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
  setItemAllergens,
  setGuestAllergies,
  checkOrderAllergies,
  getItemAllergens,
  __resetAllergenMatrixStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000ff';

describe('allergen-matrix', () => {
  beforeEach(() => {
    __resetAllergenMatrixStore();
    vi.clearAllMocks();
  });

  it('sets and reads item allergens', async () => {
    await setItemAllergens(tenantId, actorId, itemId, ['Milk', 'wheat']);
    const row = await getItemAllergens(tenantId, actorId, itemId);
    expect(row?.allergens).toEqual(['milk', 'wheat']);
  });

  it('blocks order when guest allergy conflicts', async () => {
    await setItemAllergens(tenantId, actorId, itemId, ['shellfish']);
    await setGuestAllergies(tenantId, actorId, 'guest-1', ['shellfish']);
    await expect(
      checkOrderAllergies(tenantId, actorId, {
        guestKey: 'guest-1',
        menuItemIds: [itemId],
      }),
    ).rejects.toThrow(/allergen conflict/i);
  });

  it('passes when no overlap', async () => {
    await setItemAllergens(tenantId, actorId, itemId, ['soy']);
    const result = await checkOrderAllergies(tenantId, actorId, {
      guestAllergies: ['peanuts'],
      menuItemIds: [itemId],
    });
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });
});
