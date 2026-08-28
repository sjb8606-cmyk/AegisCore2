/**
 * platform/manager-override-log (POS-04)
 *
 * Manager PIN overrides: price override, no-sale, refund, void — always logged.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('manager-override-log');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  overrideTypes: z
    .array(z.string())
    .default(['price_override', 'no_sale', 'refund', 'void', 'discount']),
  requireReason: z.boolean().default(true),
});

export interface ManagerOverride {
  id: string;
  tenantId: string;
  sessionId: string | null;
  registerId: string | null;
  cashierId: string;
  managerId: string;
  overrideType: string;
  reason: string;
  amountCents: number | null;
  originalAmountCents: number | null;
  referenceId: string | null;
  createdAt: string;
}

/** Injectable PIN verifier — returns managerId if valid */
type PinVerifier = (
  tenantId: string,
  pin: string,
) => Promise<{ valid: boolean; managerId?: string }>;

const overrides = new Map<string, ManagerOverride>();
let pinVerifier: PinVerifier = async () => ({ valid: false });

export function __resetManagerOverrideStore(): void {
  overrides.clear();
  pinVerifier = async () => ({ valid: false });
}

export function setPinVerifier(fn: PinVerifier): void {
  pinVerifier = fn;
}

export async function recordOverride(
  tenantId: string,
  actorId: string,
  input: {
    pin: string;
    cashierId: string;
    overrideType: string;
    reason?: string;
    sessionId?: string;
    registerId?: string;
    amountCents?: number;
    originalAmountCents?: number;
    referenceId?: string;
  },
): Promise<ManagerOverride> {
  return runCrudOperation({
    configName: 'manager-override-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('manager-override-log', ConfigSchema);
      if (!input.pin?.trim() || !input.cashierId?.trim()) {
        throw new AppError('pin and cashierId required', ErrorCode.BAD_REQUEST);
      }
      const type = input.overrideType?.trim().toLowerCase();
      if (
        !type ||
        !config.overrideTypes.map((t) => t.toLowerCase()).includes(type)
      ) {
        throw new AppError('invalid overrideType', ErrorCode.BAD_REQUEST);
      }
      if (config.requireReason && !input.reason?.trim()) {
        throw new AppError('reason required', ErrorCode.BAD_REQUEST);
      }
      const verified = await pinVerifier(tenantId, input.pin);
      if (!verified.valid || !verified.managerId) {
        throw new AppError('Invalid manager PIN', ErrorCode.FORBIDDEN);
      }
      const row: ManagerOverride = {
        id: crypto.randomUUID(),
        tenantId,
        sessionId: input.sessionId || null,
        registerId: input.registerId || null,
        cashierId: input.cashierId,
        managerId: verified.managerId,
        overrideType: type,
        reason: input.reason?.trim() || '',
        amountCents:
          typeof input.amountCents === 'number' ? input.amountCents : null,
        originalAmountCents:
          typeof input.originalAmountCents === 'number'
            ? input.originalAmountCents
            : null,
        referenceId: input.referenceId || null,
        createdAt: new Date().toISOString(),
      };
      overrides.set(row.id, row);
      logger.info(
        {
          overrideType: type,
          managerId: row.managerId,
          cashierId: row.cashierId,
        },
        'Manager override recorded',
      );
      return row;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'pos_manager_override',
    meterEventType: 'api_call',
  });
}

export async function listOverrides(
  tenantId: string,
  actorId: string,
  filter?: {
    sessionId?: string;
    managerId?: string;
    overrideType?: string;
    since?: string;
  },
): Promise<ManagerOverride[]> {
  return runCrudOperation({
    configName: 'manager-override-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let rows = [...overrides.values()].filter((o) => o.tenantId === tenantId);
      if (filter?.sessionId) {
        rows = rows.filter((o) => o.sessionId === filter.sessionId);
      }
      if (filter?.managerId) {
        rows = rows.filter((o) => o.managerId === filter.managerId);
      }
      if (filter?.overrideType) {
        rows = rows.filter((o) => o.overrideType === filter.overrideType);
      }
      if (filter?.since) {
        const since = Date.parse(filter.since);
        if (Number.isNaN(since)) {
          throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
        }
        rows = rows.filter((o) => Date.parse(o.createdAt) >= since);
      }
      return rows.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    },
    auditAction: 'data.read',
    auditResource: 'pos_manager_override',
    meterEventType: 'api_call',
  });
}

export async function countOverridesByType(
  tenantId: string,
  actorId: string,
  sinceIso: string,
): Promise<Record<string, number>> {
  return runCrudOperation({
    configName: 'manager-override-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = Date.parse(sinceIso);
      if (Number.isNaN(since)) {
        throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
      }
      const counts: Record<string, number> = {};
      for (const o of overrides.values()) {
        if (o.tenantId !== tenantId) continue;
        if (Date.parse(o.createdAt) < since) continue;
        counts[o.overrideType] = (counts[o.overrideType] || 0) + 1;
      }
      return counts;
    },
    auditAction: 'data.read',
    auditResource: 'pos_manager_override',
    meterEventType: 'api_call',
  });
}
