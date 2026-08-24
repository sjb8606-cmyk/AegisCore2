/**
 * platform/ag-input-trace (AG-03)
 *
 * Seed/fertilizer/pesticide lots: receive → apply to field/cycle →
 * upstream (harvest → inputs) and downstream (input → harvests) trace.
 * Algorithm mirrors lot-traceability; entity edges stored locally for Phase 1.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-input-trace');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  contaminationFlagOnDownstream: z.boolean().default(true),
});

export interface InputLot {
  id: string;
  tenantId: string;
  inputType: string;
  supplierName: string;
  lotNumber: string;
  quantity: number;
  unit: string;
  quantityRemaining: number;
  createdAt: string;
}

export interface InputApplication {
  id: string;
  tenantId: string;
  inputLotId: string;
  fieldId: string;
  cropCycleId: string;
  harvestLotId: string | null;
  quantityUsed: number;
  appliedAt: string;
  actorId: string;
}

const lots = new Map<string, InputLot>();
const applications = new Map<string, InputApplication>();
/** harvestLotId → application ids */
const harvestIndex = new Map<string, string[]>();

export function __resetAgInputTraceStore(): void {
  lots.clear();
  applications.clear();
  harvestIndex.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-input-trace', ConfigSchema);
}

export async function receiveInputLot(
  tenantId: string,
  actorId: string,
  input: {
    inputType: string;
    supplierName: string;
    lotNumber: string;
    quantity: number;
    unit: string;
  },
): Promise<InputLot> {
  return runCrudOperation({
    configName: 'ag-input-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !input.inputType?.trim() ||
        !input.supplierName?.trim() ||
        !input.lotNumber?.trim()
      ) {
        throw new AppError(
          'inputType, supplierName, lotNumber required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (typeof input.quantity !== 'number' || input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      if (!input.unit?.trim()) {
        throw new AppError('unit required', ErrorCode.BAD_REQUEST);
      }
      const lot: InputLot = {
        id: crypto.randomUUID(),
        tenantId,
        inputType: input.inputType.trim(),
        supplierName: input.supplierName.trim(),
        lotNumber: input.lotNumber.trim(),
        quantity: input.quantity,
        unit: input.unit.trim(),
        quantityRemaining: input.quantity,
        createdAt: new Date().toISOString(),
      };
      lots.set(lot.id, lot);
      logger.info({ lotId: lot.id, lotNumber: lot.lotNumber }, 'Input lot received');
      return lot;
    },
    auditAction: 'data.created',
    auditResource: 'ag_input_lot',
    meterEventType: 'api_call',
  });
}

export async function applyInputToField(
  tenantId: string,
  actorId: string,
  input: {
    inputLotId: string;
    fieldId: string;
    cropCycleId: string;
    quantityUsed: number;
    harvestLotId?: string;
  },
): Promise<InputApplication> {
  return runCrudOperation({
    configName: 'ag-input-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const lot = lots.get(input.inputLotId);
      if (!lot || lot.tenantId !== tenantId) {
        throw new AppError('Input lot not found', ErrorCode.NOT_FOUND);
      }
      if (!input.fieldId?.trim() || !input.cropCycleId?.trim()) {
        throw new AppError(
          'fieldId and cropCycleId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        typeof input.quantityUsed !== 'number' ||
        input.quantityUsed <= 0
      ) {
        throw new AppError(
          'quantityUsed must be positive',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (input.quantityUsed > lot.quantityRemaining) {
        throw new AppError('Insufficient lot quantity', ErrorCode.FORBIDDEN);
      }
      lot.quantityRemaining -= input.quantityUsed;
      lots.set(lot.id, lot);

      const app: InputApplication = {
        id: crypto.randomUUID(),
        tenantId,
        inputLotId: lot.id,
        fieldId: input.fieldId,
        cropCycleId: input.cropCycleId,
        harvestLotId: input.harvestLotId || null,
        quantityUsed: input.quantityUsed,
        appliedAt: new Date().toISOString(),
        actorId,
      };
      applications.set(app.id, app);
      if (app.harvestLotId) {
        const list = harvestIndex.get(app.harvestLotId) || [];
        list.push(app.id);
        harvestIndex.set(app.harvestLotId, list);
      }
      return app;
    },
    auditAction: 'data.created',
    auditResource: 'ag_input_application',
    meterEventType: 'api_call',
  });
}

/** Link application to harvest lot after cycle close (AG-02) */
export async function linkApplicationToHarvest(
  tenantId: string,
  actorId: string,
  applicationId: string,
  harvestLotId: string,
): Promise<InputApplication> {
  return runCrudOperation({
    configName: 'ag-input-trace',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const app = applications.get(applicationId);
      if (!app || app.tenantId !== tenantId) {
        throw new AppError('Application not found', ErrorCode.NOT_FOUND);
      }
      app.harvestLotId = harvestLotId;
      applications.set(applicationId, app);
      const list = harvestIndex.get(harvestLotId) || [];
      if (!list.includes(applicationId)) {
        list.push(applicationId);
        harvestIndex.set(harvestLotId, list);
      }
      return app;
    },
    auditAction: 'data.updated',
    auditResource: 'ag_input_application',
    meterEventType: 'api_call',
  });
}

export async function traceInputUpstream(
  tenantId: string,
  harvestLotId: string,
): Promise<
  Array<{
    inputLot: InputLot;
    application: InputApplication;
  }>
> {
  const appIds = harvestIndex.get(harvestLotId) || [];
  // also match applications that recorded harvestLotId directly
  const extra = [...applications.values()].filter(
    (a) =>
      a.tenantId === tenantId &&
      a.harvestLotId === harvestLotId &&
      !appIds.includes(a.id),
  );
  const ids = [...new Set([...appIds, ...extra.map((a) => a.id)])];
  const out: Array<{ inputLot: InputLot; application: InputApplication }> = [];
  for (const id of ids) {
    const app = applications.get(id);
    if (!app || app.tenantId !== tenantId) continue;
    const lot = lots.get(app.inputLotId);
    if (!lot) continue;
    out.push({ inputLot: lot, application: app });
  }
  return out;
}

export async function traceInputDownstream(
  tenantId: string,
  inputLotId: string,
): Promise<{
  applications: InputApplication[];
  harvestLotIds: string[];
  contaminationFlag: boolean;
}> {
  const config = await loadCfg();
  const apps = [...applications.values()].filter(
    (a) => a.tenantId === tenantId && a.inputLotId === inputLotId,
  );
  const harvestLotIds = [
    ...new Set(
      apps.map((a) => a.harvestLotId).filter((h): h is string => !!h),
    ),
  ];
  return {
    applications: apps,
    harvestLotIds,
    contaminationFlag:
      config.contaminationFlagOnDownstream && harvestLotIds.length > 0,
  };
}

export async function getInputLot(
  tenantId: string,
  lotId: string,
): Promise<InputLot | null> {
  const l = lots.get(lotId);
  if (!l || l.tenantId !== tenantId) return null;
  return l;
}
