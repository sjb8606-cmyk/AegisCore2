/**
 * platform/trainer-session-ledger (FIT-04)
 *
 * PT packages, session burn, trainer payout accrual.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
} from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('trainer-session-ledger');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTrainerPayoutCents: z.number().int().nonnegative().default(3000),
  allowOverdraw: z.boolean().default(false),
});

export interface SessionPackage {
  id: string;
  tenantId: string;
  memberId: string;
  trainerId: string;
  totalSessions: number;
  remainingSessions: number;
  purchaseCents: number;
  trainerPayoutCentsPerSession: number;
  active: boolean;
  createdAt: string;
}

export interface SessionBurn {
  id: string;
  tenantId: string;
  packageId: string;
  memberId: string;
  trainerId: string;
  payoutCents: number;
  notes: string | null;
  occurredAt: string;
}

const packages = new Map<string, SessionPackage>();
const burns = new Map<string, SessionBurn>();

export function __resetTrainerSessionStore(): void {
  packages.clear();
  burns.clear();
}

function getPackage(tenantId: string, packageId: string): SessionPackage {
  const p = packages.get(packageId);
  if (!p || p.tenantId !== tenantId) {
    throw new AppError('Package not found', ErrorCode.NOT_FOUND);
  }
  return p;
}

export async function purchasePackage(
  tenantId: string,
  actorId: string,
  input: {
    memberId: string;
    trainerId: string;
    totalSessions: number;
    purchaseCents: number;
    trainerPayoutCentsPerSession?: number;
  },
): Promise<SessionPackage> {
  return runCrudOperation({
    configName: 'trainer-session-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('trainer-session-ledger', ConfigSchema);

      if (!input.memberId?.trim() || !input.trainerId?.trim()) {
        throw new AppError(
          'memberId and trainerId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (!Number.isInteger(input.totalSessions) || input.totalSessions <= 0) {
        throw new AppError(
          'totalSessions must be positive int',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (typeof input.purchaseCents !== 'number' || input.purchaseCents < 0) {
        throw new AppError(
          'purchaseCents must be >= 0',
          ErrorCode.BAD_REQUEST,
        );
      }

      const pkg: SessionPackage = {
        id: crypto.randomUUID(),
        tenantId,
        memberId: input.memberId,
        trainerId: input.trainerId,
        totalSessions: input.totalSessions,
        remainingSessions: input.totalSessions,
        purchaseCents: input.purchaseCents,
        trainerPayoutCentsPerSession:
          input.trainerPayoutCentsPerSession ??
          config.defaultTrainerPayoutCents,
        active: true,
        createdAt: new Date().toISOString(),
      };
      packages.set(pkg.id, pkg);
      return pkg;
    },
    auditAction: 'data.created',
    auditResource: 'fit_session_package',
    meterEventType: 'api_call',
  });
}

export async function burnSession(
  tenantId: string,
  actorId: string,
  input: {
    packageId: string;
    notes?: string;
    occurredAt?: string;
  },
): Promise<{ package: SessionPackage; burn: SessionBurn }> {
  return runCrudOperation({
    configName: 'trainer-session-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('trainer-session-ledger', ConfigSchema);
      const pkg = getPackage(tenantId, input.packageId);

      // Remaining check FIRST so "blocks burn when empty" matches
      // "No remaining sessions" even after active is flipped false.
      if (pkg.remainingSessions <= 0 && !config.allowOverdraw) {
        throw new AppError('No remaining sessions', ErrorCode.CONFLICT);
      }
      if (!pkg.active) {
        throw new AppError('Package inactive', ErrorCode.CONFLICT);
      }

      pkg.remainingSessions = Math.max(0, pkg.remainingSessions - 1);
      if (pkg.remainingSessions === 0) pkg.active = false;
      packages.set(pkg.id, pkg);

      const when = input.occurredAt
        ? Date.parse(input.occurredAt)
        : Date.now();
      if (Number.isNaN(when)) {
        throw new AppError('invalid occurredAt', ErrorCode.BAD_REQUEST);
      }

      const burn: SessionBurn = {
        id: crypto.randomUUID(),
        tenantId,
        packageId: pkg.id,
        memberId: pkg.memberId,
        trainerId: pkg.trainerId,
        payoutCents: pkg.trainerPayoutCentsPerSession,
        notes: input.notes?.trim() || null,
        occurredAt: new Date(when).toISOString(),
      };
      burns.set(burn.id, burn);

      logger.info(
        { packageId: pkg.id, remaining: pkg.remainingSessions },
        'Session burned',
      );
      return { package: pkg, burn };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'fit_session_burn',
    meterEventType: 'api_call',
  });
}

export async function getTrainerPayoutSummary(
  tenantId: string,
  actorId: string,
  trainerId: string,
  sinceIso: string,
): Promise<{ trainerId: string; sessions: number; payoutCents: number }> {
  return runCrudOperation({
    configName: 'trainer-session-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = Date.parse(sinceIso);
      if (Number.isNaN(since)) {
        throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
      }
      const rows = [...burns.values()].filter(
        (b) =>
          b.tenantId === tenantId &&
          b.trainerId === trainerId &&
          Date.parse(b.occurredAt) >= since,
      );
      return {
        trainerId,
        sessions: rows.length,
        payoutCents: rows.reduce((s, b) => s + b.payoutCents, 0),
      };
    },
    auditAction: 'data.read',
    auditResource: 'fit_session_burn',
    meterEventType: 'api_call',
  });
}

export async function getPackageBalance(
  tenantId: string,
  actorId: string,
  packageId: string,
): Promise<SessionPackage> {
  return runCrudOperation({
    configName: 'trainer-session-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getPackage(tenantId, packageId),
    auditAction: 'data.read',
    auditResource: 'fit_session_package',
    meterEventType: 'api_call',
  });
}
