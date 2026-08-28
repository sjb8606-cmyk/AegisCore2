/**
 * platform/vessel-insurance-gate (MAR-03)
 *
 * Certificate of Insurance (COI) tracking per vessel.
 * assertVesselInsurable blocks berth assignment when COI missing/expired.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('vessel-insurance-gate');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockWhenExpired: z.boolean().default(true),
  expiryWarningDays: z.number().int().positive().default(30),
  minLiabilityCents: z.number().int().nonnegative().default(0),
});

export interface VesselCOI {
  id: string;
  tenantId: string;
  vesselId: string;
  carrier: string;
  policyNumber: string;
  liabilityCents: number;
  effectiveAt: string;
  expiresAt: string;
  documentRef: string | null;
  active: boolean;
  createdAt: string;
}

const coins = new Map<string, VesselCOI>();

export function __resetVesselInsuranceStore(): void {
  coins.clear();
}

function isExpired(expiresAt: string, now = Date.now()): boolean {
  return Date.parse(expiresAt) < now;
}

function activeCOIs(tenantId: string, vesselId: string): VesselCOI[] {
  return [...coins.values()].filter(
    (c) => c.tenantId === tenantId && c.vesselId === vesselId && c.active,
  );
}

export async function registerCOI(
  tenantId: string,
  actorId: string,
  input: {
    vesselId: string;
    carrier: string;
    policyNumber: string;
    liabilityCents: number;
    effectiveAt: string;
    expiresAt: string;
    documentRef?: string;
  },
): Promise<VesselCOI> {
  return runCrudOperation({
    configName: 'vessel-insurance-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.vesselId?.trim() || !input.carrier?.trim() || !input.policyNumber?.trim()) {
        throw new AppError(
          'vesselId, carrier, policyNumber required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const effective = Date.parse(input.effectiveAt);
      const expires = Date.parse(input.expiresAt);
      if (Number.isNaN(effective) || Number.isNaN(expires) || expires <= effective) {
        throw new AppError('invalid effectiveAt/expiresAt', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.liabilityCents !== 'number' || input.liabilityCents < 0) {
        throw new AppError('liabilityCents must be >= 0', ErrorCode.BAD_REQUEST);
      }
      // supersede previous active COIs for vessel
      for (const [id, c] of coins) {
        if (c.tenantId === tenantId && c.vesselId === input.vesselId && c.active) {
          c.active = false;
          coins.set(id, c);
        }
      }
      const row: VesselCOI = {
        id: crypto.randomUUID(),
        tenantId,
        vesselId: input.vesselId,
        carrier: input.carrier.trim(),
        policyNumber: input.policyNumber.trim(),
        liabilityCents: input.liabilityCents,
        effectiveAt: new Date(effective).toISOString(),
        expiresAt: new Date(expires).toISOString(),
        documentRef: input.documentRef?.trim() || null,
        active: true,
        createdAt: new Date().toISOString(),
      };
      coins.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'marina_vessel_coi',
    meterEventType: 'api_call',
  });
}

export async function revokeCOI(
  tenantId: string,
  actorId: string,
  coiId: string,
): Promise<VesselCOI> {
  return runCrudOperation({
    configName: 'vessel-insurance-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const c = coins.get(coiId);
      if (!c || c.tenantId !== tenantId) {
        throw new AppError('COI not found', ErrorCode.NOT_FOUND);
      }
      c.active = false;
      coins.set(coiId, c);
      return c;
    },
    auditAction: 'data.updated',
    auditResource: 'marina_vessel_coi',
    meterEventType: 'api_call',
  });
}

export async function assertVesselInsurable(
  tenantId: string,
  vesselId: string,
): Promise<{ insurable: boolean; coiId: string | null; expiresAt: string | null }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('vessel-insurance-gate', ConfigSchema);
  const list = activeCOIs(tenantId, vesselId);
  const now = Date.now();
  const valid = list.find(
    (c) =>
      !isExpired(c.expiresAt, now) &&
      Date.parse(c.effectiveAt) <= now &&
      c.liabilityCents >= config.minLiabilityCents,
  );
  if (!valid) {
    if (config.blockWhenExpired) {
      throw new AppError(
        'Vessel not insurable: missing or expired COI',
        ErrorCode.FORBIDDEN,
      );
    }
    return { insurable: false, coiId: null, expiresAt: null };
  }
  return {
    insurable: true,
    coiId: valid.id,
    expiresAt: valid.expiresAt,
  };
}

export async function listExpiringCOIs(
  tenantId: string,
  actorId: string,
  withinDays?: number,
): Promise<VesselCOI[]> {
  return runCrudOperation({
    configName: 'vessel-insurance-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('vessel-insurance-gate', ConfigSchema);
      const days = withinDays ?? config.expiryWarningDays;
      const now = Date.now();
      const horizon = now + days * 86_400_000;
      return [...coins.values()].filter((c) => {
        if (c.tenantId !== tenantId || !c.active) return false;
        const exp = Date.parse(c.expiresAt);
        return exp >= now && exp <= horizon;
      });
    },
    auditAction: 'data.read',
    auditResource: 'marina_vessel_coi',
    meterEventType: 'api_call',
  });
}

export async function getVesselCOI(
  tenantId: string,
  actorId: string,
  vesselId: string,
): Promise<VesselCOI | null> {
  return runCrudOperation({
    configName: 'vessel-insurance-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const list = activeCOIs(tenantId, vesselId);
      return list.sort(
        (a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt),
      )[0] || null;
    },
    auditAction: 'data.read',
    auditResource: 'marina_vessel_coi',
    meterEventType: 'api_call',
  });
}
