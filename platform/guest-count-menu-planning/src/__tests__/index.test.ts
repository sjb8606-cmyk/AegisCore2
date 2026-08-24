import { beforeEach, describe, expect, it } from 'vitest';
import {
  setGuestCount,
  setMenuItems,
  calculateQuantities,
  flagDietaryConflicts,
  __resetGuestCountMenuPlanningStore
} from '../index';

describe('guest-count-menu-planning', () => {
  beforeEach(() => {
    __resetGuestCountMenuPlanningStore();
  });

  it('calculates menu quantities from guest count', async () => {
    await setGuestCount(
      'tenant-1',
      'actor-1',
      'event-1',
      50
    );

    await setMenuItems(
      'tenant-1',
      'actor-1',
      'event-1',
      [
        {
          itemName: 'Salad',
          quantityPerGuest: 1,
          dietaryFlags: ['vegetarian', 'vegan']
        },
        {
          itemName: 'Dessert',
          quantityPerGuest: 0.5,
          dietaryFlags: []
        }
      ]
    );

    const quantities = await calculateQuantities(
      'tenant-1',
      'actor-1',
      'event-1'
    );

    expect(quantities.Salad).toBe(50);
    expect(quantities.Dessert).toBe(25);
  });

  it('rejects a negative guest count', async () => {
    await expect(
      setGuestCount(
        'tenant-1',
        'actor-1',
        'event-1',
        -1
      )
    ).rejects.toThrow('guestCount must be a non-negative integer');
  });

  it('flags dietary conflicts requiring confirmation', async () => {
    await setGuestCount(
      'tenant-1',
      'actor-1',
      'event-1',
      100
    );

    await setMenuItems(
      'tenant-1',
      'actor-1',
      'event-1',
      [
        {
          itemName: 'Special Meal',
          quantityPerGuest: 1,
          dietaryFlags: ['halal', 'kosher']
        }
      ]
    );

    const conflicts = await flagDietaryConflicts(
      'tenant-1',
      'actor-1',
      'event-1'
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('halal and kosher');
  });
});
