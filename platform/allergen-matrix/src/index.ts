/**
 * platform/allergen-matrix (REST-03)
 *
 * Menu item allergen tags + guest allergy checks on orders.
 * Config: warn vs hard-block on conflict.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('allergen-matrix');

const STANDARD_ALLERGENS = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
] as const;

export type StandardAllergen = (typeof STANDARD_ALLERGENS)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  conflictMode: z.enum(['warn', 'block']).default('block'),
  knownAllergens: z
    .array(z.string())
    .default([...STANDARD_ALLERGENS]),
});

export interface MenuItemAllergens {
  tenantId: string;
  menuItemId: string;
  allergens: string[];
  updatedAt: string;
}

export interface GuestAllergyProfile {
  tenantId: string;
  guestKey: string;
  allergies: string[];
  updatedAt: string;
}

export interface ConflictResult {
  ok: boolean;
  mode: 'warn' | 'block';
  conflicts: Array<{ menuItemId: string; allergen: string }>;
  warnings: string[];
}

const itemAllergens = new Map<string, MenuItemAllergens>();
const guestProfiles = new Map<string, GuestAllergyProfile>();

export function __resetAllergenMatrixStore(): void {
  itemAllergens.clear();
  guestProfiles.clear();
}

function itemKey(tenantId: string, menuItemId: string): string {
  return tenantId + ':' + menuItemId;
}
function guestKey(tenantId: string, guestKey: string): string {
  return tenantId + ':' + guestKey;
}

function normalize(list: string[]): string[] {
  return [...new Set(list.map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

export async function setItemAllergens(
  tenantId: string,
  actorId: string,
  menuItemId: string,
  allergens: string[],
): Promise<MenuItemAllergens> {
  return runCrudOperation({
    configName: 'allergen-matrix',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!menuItemId?.trim()) {
        throw new AppError('menuItemId required', ErrorCode.BAD_REQUEST);
      }
      const row: MenuItemAllergens = {
        tenantId,
        menuItemId,
        allergens: normalize(allergens),
        updatedAt: new Date().toISOString(),
      };
      itemAllergens.set(itemKey(tenantId, menuItemId), row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_item_allergens',
    meterEventType: 'api_call',
  });
}

export async function setGuestAllergies(
  tenantId: string,
  actorId: string,
  guestKeyInput: string,
  allergies: string[],
): Promise<GuestAllergyProfile> {
  return runCrudOperation({
    configName: 'allergen-matrix',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!guestKeyInput?.trim()) {
        throw new AppError('guestKey required', ErrorCode.BAD_REQUEST);
      }
      const row: GuestAllergyProfile = {
        tenantId,
        guestKey: guestKeyInput.trim(),
        allergies: normalize(allergies),
        updatedAt: new Date().toISOString(),
      };
      guestProfiles.set(guestKey(tenantId, row.guestKey), row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_guest_allergies',
    meterEventType: 'api_call',
  });
}

export async function checkOrderAllergies(
  tenantId: string,
  actorId: string,
  input: {
    guestKey?: string;
    guestAllergies?: string[];
    menuItemIds: string[];
  },
): Promise<ConflictResult> {
  return runCrudOperation({
    configName: 'allergen-matrix',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('allergen-matrix', ConfigSchema);

      let guestAllergies = normalize(input.guestAllergies || []);
      if (input.guestKey?.trim()) {
        const profile = guestProfiles.get(
          guestKey(tenantId, input.guestKey.trim()),
        );
        if (profile) {
          guestAllergies = normalize([
            ...guestAllergies,
            ...profile.allergies,
          ]);
        }
      }

      const conflicts: Array<{ menuItemId: string; allergen: string }> = [];
      for (const menuItemId of input.menuItemIds || []) {
        const item = itemAllergens.get(itemKey(tenantId, menuItemId));
        if (!item) continue;
        for (const a of item.allergens) {
          if (guestAllergies.includes(a)) {
            conflicts.push({ menuItemId, allergen: a });
          }
        }
      }

      const warnings = conflicts.map(
        (c) => 'Item ' + c.menuItemId + ' contains ' + c.allergen,
      );

      if (conflicts.length > 0 && config.conflictMode === 'block') {
        logger.warn({ conflicts }, 'Allergen conflict blocked');
        throw new AppError(
          'Allergen conflict: ' + warnings.join('; '),
          ErrorCode.FORBIDDEN,
        );
      }

      return {
        ok: conflicts.length === 0,
        mode: config.conflictMode,
        conflicts,
        warnings,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'rest_allergen_check',
    meterEventType: 'api_call',
  });
}

export async function getItemAllergens(
  tenantId: string,
  actorId: string,
  menuItemId: string,
): Promise<MenuItemAllergens | null> {
  return runCrudOperation({
    configName: 'allergen-matrix',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      itemAllergens.get(itemKey(tenantId, menuItemId)) || null,
    auditAction: 'data.read',
    auditResource: 'rest_item_allergens',
    meterEventType: 'api_call',
  });
}
