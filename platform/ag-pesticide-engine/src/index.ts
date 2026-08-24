/**
 * platform/ag-pesticide-engine (AG-04)
 *
 * Deterministic pesticide application validation + PHI harvest lockout.
 * Safe-AI boundary: ZERO LLM involvement in allow/block decisions.
 *
 * Checks:
 * 1. Applicator Class L / commercial cert valid (via injectable cert check)
 * 2. Restricted zones on field (via injectable zone check)
 * 3. Rate vs PMRA label max
 * 4. PHI lock on field until date passes
 * 5. Optional AG-02 logEvent hook after success
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-pesticide-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxWindSpeedKmh: z.number().positive().default(20),
  requireCertTypes: z
    .array(z.string())
    .default(['class_l_pesticide', 'commercial_applicator']),
});

export interface PmraLabelRate {
  pmraRegistrationNumber: string;
  productName: string;
  maxRatePerHa: number;
  phiDays: number;
  reiHours: number;
}

export interface PesticideApplication {
  id: string;
  tenantId: string;
  fieldId: string;
  cropCycleId: string;
  productName: string;
  pmraRegistrationNumber: string;
  rateAppliedPerHa: number;
  windSpeedKmh: number;
  weatherConditions: string;
  phiUnlockAt: string;
  appliedAt: string;
  actorId: string;
}

export interface HarvestLock {
  fieldId: string;
  tenantId: string;
  locked: boolean;
  unlockAt: string | null;
  reason: string | null;
  applicationId: string | null;
}

/** Injectable collaborators (AG-01 / AG-05 / AG-02) */
type CertCheckFn = (
  tenantId: string,
  holderId: string,
) => Promise<boolean>;
type RestrictedZoneFn = (
  tenantId: string,
  fieldId: string,
) => Promise<Array<{ zoneType: string; reason: string }>>;
type LogCropEventFn = (
  tenantId: string,
  actorId: string,
  cropCycleId: string,
  payload: Record<string, unknown>,
) => Promise<void>;

const labelRates = new Map<string, PmraLabelRate>();
const applications = new Map<string, PesticideApplication>();
const locks = new Map<string, HarvestLock>(); // tenant:fieldId

let certCheck: CertCheckFn = async () => false;
let restrictedZones: RestrictedZoneFn = async () => [];
let logCropEvent: LogCropEventFn = async () => {};

export function __resetAgPesticideEngineStore(): void {
  labelRates.clear();
  applications.clear();
  locks.clear();
  certCheck = async () => false;
  restrictedZones = async () => [];
  logCropEvent = async () => {};
}

export function setCertCheckFn(fn: CertCheckFn): void {
  certCheck = fn;
}
export function setRestrictedZoneFn(fn: RestrictedZoneFn): void {
  restrictedZones = fn;
}
export function setLogCropEventFn(fn: LogCropEventFn): void {
  logCropEvent = fn;
}

export function seedPmraLabel(rate: PmraLabelRate): void {
  labelRates.set(rate.pmraRegistrationNumber, rate);
}

function lockKey(tenantId: string, fieldId: string): string {
  return tenantId + ':' + fieldId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-pesticide-engine', ConfigSchema);
}

export async function logApplication(
  tenantId: string,
  actorId: string,
  input: {
    fieldId: string;
    cropCycleId: string;
    productName: string;
    pmraRegistrationNumber: string;
    rateAppliedPerHa: number;
    windSpeedKmh: number;
    weatherConditions?: string;
    applicatorHolderId?: string;
  },
): Promise<PesticideApplication> {
  return runCrudOperation({
    configName: 'ag-pesticide-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();

      if (!input.fieldId || !input.cropCycleId || !input.pmraRegistrationNumber) {
        throw new AppError(
          'fieldId, cropCycleId, pmraRegistrationNumber required',
          ErrorCode.BAD_REQUEST,
        );
      }

      // 1. Certificate
      const holderId = input.applicatorHolderId || actorId;
      const certOk = await certCheck(tenantId, holderId);
      if (!certOk) {
        throw new AppError(
          'Applicator certificate missing or expired',
          ErrorCode.FORBIDDEN,
        );
      }

      // 2. Restricted zones (WAWA etc.) — block if any active restricted zone
      const zones = await restrictedZones(tenantId, input.fieldId);
      const blocking = zones.filter(
        (z) =>
          z.zoneType === 'wawa_buffer' ||
          z.zoneType === 'watercourse' ||
          z.zoneType === 'wetland',
      );
      if (blocking.length > 0) {
        throw new AppError(
          'Application blocked: field has restricted zone (' +
            blocking[0].zoneType +
            ')',
          ErrorCode.FORBIDDEN,
        );
      }

      // 3. PMRA label rate
      const label = labelRates.get(input.pmraRegistrationNumber);
      if (!label) {
        throw new AppError(
          'Unknown PMRA registration number — no label rate on file',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        typeof input.rateAppliedPerHa !== 'number' ||
        input.rateAppliedPerHa <= 0
      ) {
        throw new AppError('rateAppliedPerHa must be positive', ErrorCode.BAD_REQUEST);
      }
      if (input.rateAppliedPerHa > label.maxRatePerHa) {
        throw new AppError(
          'Rate exceeds PMRA label max (' + label.maxRatePerHa + '/ha)',
          ErrorCode.FORBIDDEN,
        );
      }

      // Wind safety (deterministic operational rule)
      if (input.windSpeedKmh > config.maxWindSpeedKmh) {
        throw new AppError(
          'Wind speed exceeds safe application limit',
          ErrorCode.FORBIDDEN,
        );
      }

      // 4. PHI lock
      const appliedAt = new Date();
      const unlockAt = new Date(
        appliedAt.getTime() + label.phiDays * 86_400_000,
      );

      const app: PesticideApplication = {
        id: crypto.randomUUID(),
        tenantId,
        fieldId: input.fieldId,
        cropCycleId: input.cropCycleId,
        productName: input.productName || label.productName,
        pmraRegistrationNumber: input.pmraRegistrationNumber,
        rateAppliedPerHa: input.rateAppliedPerHa,
        windSpeedKmh: input.windSpeedKmh,
        weatherConditions: input.weatherConditions || '',
        phiUnlockAt: unlockAt.toISOString(),
        appliedAt: appliedAt.toISOString(),
        actorId,
      };
      applications.set(app.id, app);

      // Extend lock if later than existing
      const key = lockKey(tenantId, input.fieldId);
      const existing = locks.get(key);
      let lockUntil = unlockAt;
      if (existing?.unlockAt && Date.parse(existing.unlockAt) > unlockAt.getTime()) {
        lockUntil = new Date(existing.unlockAt);
      }
      locks.set(key, {
        fieldId: input.fieldId,
        tenantId,
        locked: true,
        unlockAt: lockUntil.toISOString(),
        reason: 'PHI lock after ' + app.productName,
        applicationId: app.id,
      });

      // 5. Chain into crop cycle event log
      await logCropEvent(tenantId, actorId, input.cropCycleId, {
        eventType: 'pesticide_application',
        applicationId: app.id,
        pmraRegistrationNumber: app.pmraRegistrationNumber,
        rateAppliedPerHa: app.rateAppliedPerHa,
        phiUnlockAt: app.phiUnlockAt,
      });

      logger.info(
        { applicationId: app.id, fieldId: input.fieldId, unlockAt: app.phiUnlockAt },
        'Pesticide application logged + PHI lock set',
      );
      return app;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ag_pesticide_application',
    meterEventType: 'api_call',
  });
}

export async function checkHarvestEligibility(
  tenantId: string,
  fieldId: string,
): Promise<{
  eligible: boolean;
  locked: boolean;
  unlockAt: string | null;
  reason: string | null;
}> {
  const key = lockKey(tenantId, fieldId);
  const lock = locks.get(key);
  if (!lock || !lock.locked || !lock.unlockAt) {
    return { eligible: true, locked: false, unlockAt: null, reason: null };
  }
  if (Date.parse(lock.unlockAt) <= Date.now()) {
    // auto-clear when PHI passed
    lock.locked = false;
    locks.set(key, lock);
    return { eligible: true, locked: false, unlockAt: lock.unlockAt, reason: null };
  }
  return {
    eligible: false,
    locked: true,
    unlockAt: lock.unlockAt,
    reason: lock.reason,
  };
}

/**
 * System-triggered release after PHI date. Manual override must go through
 * a Synchronous Gate (HITL) — this API only allows release when unlockAt has passed.
 */
export async function releaseHarvestLock(
  tenantId: string,
  actorId: string,
  fieldId: string,
  opts?: { force?: boolean; gateApproved?: boolean },
): Promise<HarvestLock> {
  return runCrudOperation({
    configName: 'ag-pesticide-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const key = lockKey(tenantId, fieldId);
      const lock = locks.get(key);
      if (!lock) {
        return {
          fieldId,
          tenantId,
          locked: false,
          unlockAt: null,
          reason: null,
          applicationId: null,
        };
      }
      const phiPassed =
        lock.unlockAt && Date.parse(lock.unlockAt) <= Date.now();
      if (!phiPassed && !(opts?.force && opts?.gateApproved)) {
        throw new AppError(
          'PHI not cleared — manual override requires Synchronous Gate approval',
          ErrorCode.FORBIDDEN,
        );
      }
      lock.locked = false;
      lock.reason = phiPassed
        ? 'PHI cleared'
        : 'Manual override via Synchronous Gate';
      locks.set(key, lock);
      logger.info({ fieldId, force: !!opts?.force }, 'Harvest lock released');
      return lock;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ag_harvest_lock',
    meterEventType: 'api_call',
  });
}

export async function listApplications(
  tenantId: string,
  fieldId?: string,
): Promise<PesticideApplication[]> {
  return [...applications.values()].filter(
    (a) =>
      a.tenantId === tenantId && (!fieldId || a.fieldId === fieldId),
  );
}
