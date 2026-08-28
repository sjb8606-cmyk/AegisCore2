import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
} from '@platform/crud-kernel';

export type DietaryFlag =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'nut_free'
  | 'halal'
  | 'kosher';

export type MenuItem = {
  itemName: string;
  quantityPerGuest: number;
  dietaryFlags: DietaryFlag[];
};

export type GuestMenuPlan = {
  eventId: string;
  guestCount: number;
  menuItems: MenuItem[];
  dietaryRestrictionSummary: Record<DietaryFlag, number>;
  createdAt: string;
  updatedAt: string;
};

const store = new Map<string, GuestMenuPlan>();

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      apiCallsPerMonth: z.number().default(10000),
    })
    .default({ apiCallsPerMonth: 10000 }),
  features: z
    .object({
      guestCountPlanning: z.boolean().default(true),
      quantityCalculation: z.boolean().default(true),
      dietaryTracking: z.boolean().default(true),
    })
    .default({
      guestCountPlanning: true,
      quantityCalculation: true,
      dietaryTracking: true,
    }),
});

const emptySummary = (): Record<DietaryFlag, number> => ({
  vegetarian: 0,
  vegan: 0,
  gluten_free: 0,
  nut_free: 0,
  halal: 0,
  kosher: 0,
});

function getPlan(eventId: string): GuestMenuPlan {
  const plan = store.get(eventId);
  if (!plan) {
    throw new AppError(
      'Guest menu plan not found',
      ErrorCode.NOT_FOUND,
    );
  }
  return plan;
}

function validateGuestCount(guestCount: number): void {
  if (!Number.isInteger(guestCount) || guestCount < 0) {
    throw new AppError(
      'guestCount must be a non-negative integer',
      ErrorCode.BAD_REQUEST,
    );
  }
}

function validateMenuItems(menuItems: MenuItem[]): void {
  if (!Array.isArray(menuItems)) {
    throw new AppError(
      'menuItems must be an array',
      ErrorCode.BAD_REQUEST,
    );
  }
  for (const item of menuItems) {
    if (!item.itemName.trim()) {
      throw new AppError('itemName is required', ErrorCode.BAD_REQUEST);
    }
    if (!Number.isFinite(item.quantityPerGuest) || item.quantityPerGuest < 0) {
      throw new AppError(
        'quantityPerGuest must be non-negative',
        ErrorCode.BAD_REQUEST,
      );
    }
  }
}

function buildSummary(menuItems: MenuItem[]): Record<DietaryFlag, number> {
  const summary = emptySummary();
  for (const item of menuItems) {
    for (const flag of item.dietaryFlags) {
      summary[flag] += 1;
    }
  }
  return summary;
}

export async function setGuestCount(
  tenantId: string,
  actorId: string,
  eventId: string,
  guestCount: number,
): Promise<GuestMenuPlan> {
  validateGuestCount(guestCount);

  const existing = store.get(eventId);

  const plan: GuestMenuPlan = {
    eventId,
    guestCount,
    menuItems: existing?.menuItems ?? [],
    dietaryRestrictionSummary:
      existing?.dietaryRestrictionSummary ?? emptySummary(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'guest-count-menu-planning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: existing ? 'data.updated' : 'data.created',
    auditResource: 'guest-count-menu-planning',
    meterEventType: 'api_call',
    action: async () => {
      store.set(eventId, plan);
      return plan;
    },
  });
}

export async function setMenuItems(
  tenantId: string,
  actorId: string,
  eventId: string,
  menuItems: MenuItem[],
): Promise<GuestMenuPlan> {
  validateMenuItems(menuItems);

  const existing = getPlan(eventId);

  const plan: GuestMenuPlan = {
    ...existing,
    menuItems,
    dietaryRestrictionSummary: buildSummary(menuItems),
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'guest-count-menu-planning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'guest-count-menu-planning',
    meterEventType: 'api_call',
    action: async () => {
      store.set(eventId, plan);
      return plan;
    },
  });
}

export async function calculateQuantities(
  tenantId: string,
  actorId: string,
  eventId: string,
): Promise<Record<string, number>> {
  const plan = getPlan(eventId);

  return runCrudOperation({
    configName: 'guest-count-menu-planning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'guest-count-menu-planning',
    meterEventType: 'api_call',
    action: async () => {
      const quantities: Record<string, number> = {};
      for (const item of plan.menuItems) {
        quantities[item.itemName] =
          item.quantityPerGuest * plan.guestCount;
      }
      return quantities;
    },
  });
}

export async function flagDietaryConflicts(
  tenantId: string,
  actorId: string,
  eventId: string,
): Promise<string[]> {
  const plan = getPlan(eventId);

  return runCrudOperation({
    configName: 'guest-count-menu-planning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'guest-count-menu-planning',
    meterEventType: 'api_call',
    action: async () => {
      const conflicts: string[] = [];
      for (const item of plan.menuItems) {
        const flags = new Set(item.dietaryFlags);
        if (flags.has('vegan') && !flags.has('vegetarian')) {
          conflicts.push(
            `${item.itemName}: vegan item must also satisfy vegetarian requirements`,
          );
        }
        if (flags.has('halal') && flags.has('kosher')) {
          conflicts.push(
            `${item.itemName}: halal and kosher requirements require confirmation`,
          );
        }
      }
      return conflicts;
    },
  });
}

export function __resetGuestCountMenuPlanningStore(): void {
  store.clear();
}
