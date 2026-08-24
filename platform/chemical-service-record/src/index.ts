/**
 * platform/chemical-service-record (SAL-02)
 *
 * Color/chemical formulas, patch-test gates, product lot refs, adverse reactions.
 * Liability trail for chemical services.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('chemical-service-record');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requirePatchTestForNewClient: z.boolean().default(true),
  patchTestValidityDays: z.number().int().positive().default(180),
  blockOnFailedPatchTest: z.boolean().default(true),
});

export type PatchTestResult = 'passed' | 'failed' | 'not_done';

export interface ChemicalServiceRecord {
  id: string;
  tenantId: string;
  clientId: string;
  visitId: string | null;
  stylistId: string;
  serviceType: string;
  formula: string;
  developerVolume: string | null;
  products: Array<{ name: string; lotNumber?: string }>;
  patchTestAt: string | null;
  patchTestResult: PatchTestResult;
  reactionNotes: string | null;
  createdAt: string;
  actorId: string;
}

const records = new Map<string, ChemicalServiceRecord>();
/** clientId → latest successful patch test ISO date */
const lastPassedPatch = new Map<string, string>();

export function __resetChemicalServiceRecordStore(): void {
  records.clear();
  lastPassedPatch.clear();
}

function clientKey(tenantId: string, clientId: string): string {
  return tenantId + ':' + clientId;
}

export async function logPatchTest(
  tenantId: string,
  actorId: string,
  input: {
    clientId: string;
    result: PatchTestResult;
    notes?: string;
    testedAt?: string;
  },
): Promise<{ clientId: string; result: PatchTestResult; testedAt: string }> {
  return runCrudOperation({
    configName: 'chemical-service-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.clientId?.trim()) {
        throw new AppError('clientId required', ErrorCode.BAD_REQUEST);
      }
      if (!['passed', 'failed', 'not_done'].includes(input.result)) {
        throw new AppError('invalid patch test result', ErrorCode.BAD_REQUEST);
      }
      const testedAt = input.testedAt
        ? new Date(Date.parse(input.testedAt)).toISOString()
        : new Date().toISOString();
      if (input.result === 'passed') {
        lastPassedPatch.set(clientKey(tenantId, input.clientId), testedAt);
      } else if (input.result === 'failed') {
        lastPassedPatch.delete(clientKey(tenantId, input.clientId));
      }
      return { clientId: input.clientId, result: input.result, testedAt };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'salon_patch_test',
    meterEventType: 'api_call',
  });
}

export async function requirePatchTest(
  tenantId: string,
  clientId: string,
): Promise<{ ok: boolean; reason: string | null; lastPassedAt: string | null }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('chemical-service-record', ConfigSchema);
  const key = clientKey(tenantId, clientId);
  const last = lastPassedPatch.get(key) || null;
  if (!last) {
    if (config.requirePatchTestForNewClient) {
      return {
        ok: false,
        reason: 'No passed patch test on file',
        lastPassedAt: null,
      };
    }
    return { ok: true, reason: null, lastPassedAt: null };
  }
  const ageMs = Date.now() - Date.parse(last);
  const validMs = config.patchTestValidityDays * 86_400_000;
  if (ageMs > validMs) {
    return {
      ok: false,
      reason: 'Patch test expired',
      lastPassedAt: last,
    };
  }
  return { ok: true, reason: null, lastPassedAt: last };
}

export async function logChemicalService(
  tenantId: string,
  actorId: string,
  input: {
    clientId: string;
    visitId?: string;
    stylistId: string;
    serviceType: string;
    formula: string;
    developerVolume?: string;
    products?: Array<{ name: string; lotNumber?: string }>;
    patchTestResult?: PatchTestResult;
    reactionNotes?: string;
  },
): Promise<ChemicalServiceRecord> {
  return runCrudOperation({
    configName: 'chemical-service-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('chemical-service-record', ConfigSchema);

      if (!input.clientId?.trim() || !input.stylistId?.trim()) {
        throw new AppError('clientId and stylistId required', ErrorCode.BAD_REQUEST);
      }
      if (!input.serviceType?.trim() || !input.formula?.trim()) {
        throw new AppError('serviceType and formula required', ErrorCode.BAD_REQUEST);
      }

      if (input.patchTestResult === 'failed' && config.blockOnFailedPatchTest) {
        throw new AppError(
          'Chemical service blocked: failed patch test',
          ErrorCode.FORBIDDEN,
        );
      }

      const gate = await requirePatchTest(tenantId, input.clientId);
      if (
        !gate.ok &&
        input.patchTestResult !== 'passed' &&
        config.blockOnFailedPatchTest
      ) {
        throw new AppError(
          'Chemical service blocked: ' + (gate.reason || 'patch test required'),
          ErrorCode.FORBIDDEN,
        );
      }

      if (input.patchTestResult === 'passed') {
        lastPassedPatch.set(
          clientKey(tenantId, input.clientId),
          new Date().toISOString(),
        );
      }

      const rec: ChemicalServiceRecord = {
        id: crypto.randomUUID(),
        tenantId,
        clientId: input.clientId,
        visitId: input.visitId || null,
        stylistId: input.stylistId,
        serviceType: input.serviceType.trim(),
        formula: input.formula.trim(),
        developerVolume: input.developerVolume?.trim() || null,
        products: input.products || [],
        patchTestAt: gate.lastPassedAt,
        patchTestResult: input.patchTestResult || (gate.ok ? 'passed' : 'not_done'),
        reactionNotes: input.reactionNotes?.trim() || null,
        createdAt: new Date().toISOString(),
        actorId,
      };
      records.set(rec.id, rec);
      logger.info(
        { recordId: rec.id, clientId: rec.clientId },
        'Chemical service logged',
      );
      return rec;
    },
    auditAction: 'data.created',
    auditResource: 'salon_chemical_service',
    meterEventType: 'api_call',
  });
}

export async function getClientColorHistory(
  tenantId: string,
  actorId: string,
  clientId: string,
): Promise<ChemicalServiceRecord[]> {
  return runCrudOperation({
    configName: 'chemical-service-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      return [...records.values()]
        .filter((r) => r.tenantId === tenantId && r.clientId === clientId)
        .sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        );
    },
    auditAction: 'data.read',
    auditResource: 'salon_chemical_service',
    meterEventType: 'api_call',
  });
}

export async function logAdverseReaction(
  tenantId: string,
  actorId: string,
  recordId: string,
  notes: string,
): Promise<ChemicalServiceRecord> {
  return runCrudOperation({
    configName: 'chemical-service-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rec = records.get(recordId);
      if (!rec || rec.tenantId !== tenantId) {
        throw new AppError('Record not found', ErrorCode.NOT_FOUND);
      }
      if (!notes?.trim()) {
        throw new AppError('notes required', ErrorCode.BAD_REQUEST);
      }
      rec.reactionNotes = notes.trim();
      records.set(recordId, rec);
      logger.warn({ recordId, clientId: rec.clientId }, 'Adverse reaction logged');
      return rec;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'salon_chemical_service',
    meterEventType: 'api_call',
  });
}
