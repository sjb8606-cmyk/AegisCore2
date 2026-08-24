/**
 * platform/licensing-cert-tracker (SAL-05)
 *
 * Cosmetology / specialty licenses per stylist.
 * assertBookable blocks scheduling when required cert is missing or expired.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('licensing-cert-tracker');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockBookingWhenExpired: z.boolean().default(true),
  expiryWarningDays: z.number().int().positive().default(30),
  requiredLicenseTypes: z.array(z.string()).default(['cosmetology']),
});

export interface StaffLicense {
  id: string;
  tenantId: string;
  staffId: string;
  licenseType: string;
  licenseNumber: string;
  issuedAt: string;
  expiresAt: string;
  active: boolean;
  createdAt: string;
}

const licenses = new Map<string, StaffLicense>();

export function __resetLicensingCertStore(): void {
  licenses.clear();
}

function isExpired(expiresAt: string, now = Date.now()): boolean {
  return Date.parse(expiresAt) < now;
}

export async function registerLicense(
  tenantId: string,
  actorId: string,
  input: {
    staffId: string;
    licenseType: string;
    licenseNumber: string;
    issuedAt: string;
    expiresAt: string;
  },
): Promise<StaffLicense> {
  return runCrudOperation({
    configName: 'licensing-cert-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.staffId?.trim() || !input.licenseType?.trim()) {
        throw new AppError('staffId and licenseType required', ErrorCode.BAD_REQUEST);
      }
      if (!input.licenseNumber?.trim()) {
        throw new AppError('licenseNumber required', ErrorCode.BAD_REQUEST);
      }
      const issued = Date.parse(input.issuedAt);
      const expires = Date.parse(input.expiresAt);
      if (Number.isNaN(issued) || Number.isNaN(expires) || expires <= issued) {
        throw new AppError('invalid issuedAt/expiresAt', ErrorCode.BAD_REQUEST);
      }
      const lic: StaffLicense = {
        id: crypto.randomUUID(),
        tenantId,
        staffId: input.staffId,
        licenseType: input.licenseType.trim().toLowerCase(),
        licenseNumber: input.licenseNumber.trim(),
        issuedAt: new Date(issued).toISOString(),
        expiresAt: new Date(expires).toISOString(),
        active: true,
        createdAt: new Date().toISOString(),
      };
      licenses.set(lic.id, lic);
      return lic;
    },
    auditAction: 'data.created',
    auditResource: 'staff_license',
    meterEventType: 'api_call',
  });
}

export async function revokeLicense(
  tenantId: string,
  actorId: string,
  licenseId: string,
): Promise<StaffLicense> {
  return runCrudOperation({
    configName: 'licensing-cert-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const lic = licenses.get(licenseId);
      if (!lic || lic.tenantId !== tenantId) {
        throw new AppError('License not found', ErrorCode.NOT_FOUND);
      }
      lic.active = false;
      licenses.set(licenseId, lic);
      return lic;
    },
    auditAction: 'data.updated',
    auditResource: 'staff_license',
    meterEventType: 'api_call',
  });
}

export async function assertBookable(
  tenantId: string,
  staffId: string,
  requiredTypes?: string[],
): Promise<{ bookable: boolean; missing: string[]; expiringSoon: StaffLicense[] }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('licensing-cert-tracker', ConfigSchema);
  const required = (requiredTypes && requiredTypes.length > 0
    ? requiredTypes
    : config.requiredLicenseTypes
  ).map((t) => t.toLowerCase());

  const staffLicenses = [...licenses.values()].filter(
    (l) => l.tenantId === tenantId && l.staffId === staffId && l.active,
  );

  const missing: string[] = [];
  const expiringSoon: StaffLicense[] = [];
  const warnMs = config.expiryWarningDays * 86_400_000;
  const now = Date.now();

  for (const type of required) {
    const match = staffLicenses.find((l) => l.licenseType === type);
    if (!match) {
      missing.push(type);
      continue;
    }
    if (isExpired(match.expiresAt, now)) {
      missing.push(type + ' (expired)');
    } else if (Date.parse(match.expiresAt) - now <= warnMs) {
      expiringSoon.push(match);
    }
  }

  const bookable = missing.length === 0;
  if (!bookable && config.blockBookingWhenExpired) {
    throw new AppError(
      'Staff not bookable: ' + missing.join(', '),
      ErrorCode.FORBIDDEN,
    );
  }
  return { bookable, missing, expiringSoon };
}

export async function listExpiringLicenses(
  tenantId: string,
  actorId: string,
  withinDays?: number,
): Promise<StaffLicense[]> {
  return runCrudOperation({
    configName: 'licensing-cert-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('licensing-cert-tracker', ConfigSchema);
      const days = withinDays ?? config.expiryWarningDays;
      const horizon = Date.now() + days * 86_400_000;
      const now = Date.now();
      return [...licenses.values()].filter((l) => {
        if (l.tenantId !== tenantId || !l.active) return false;
        const exp = Date.parse(l.expiresAt);
        return exp >= now && exp <= horizon;
      });
    },
    auditAction: 'data.read',
    auditResource: 'staff_license',
    meterEventType: 'api_call',
  });
}

export async function listStaffLicenses(
  tenantId: string,
  actorId: string,
  staffId: string,
): Promise<StaffLicense[]> {
  return runCrudOperation({
    configName: 'licensing-cert-tracker',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...licenses.values()].filter(
        (l) => l.tenantId === tenantId && l.staffId === staffId,
      ),
    auditAction: 'data.read',
    auditResource: 'staff_license',
    meterEventType: 'api_call',
  });
}
