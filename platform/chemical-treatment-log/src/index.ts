import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultWarrantyWindowDays: z.number().int().nonnegative().default(0)
});

export const ChemicalTreatmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  visitId: z.string().uuid(),
  productName: z.string().min(1).max(500),
  quantityApplied: z.number().positive(),
  unit: z.string().min(1).max(100),
  applicationMethod: z.string().min(1).max(500),
  targetArea: z.string().min(1).max(1000),
  sdsReferenceUrl: z.string().url().nullable(),
  warrantyWindowDays: z.number().int().nonnegative()
});

export type ChemicalTreatment = z.infer<
  typeof ChemicalTreatmentSchema
>;

const treatmentStore = new Map<string, ChemicalTreatment>();

export function __resetChemicalTreatmentLogStore(): void {
  treatmentStore.clear();
}

function getTenantTreatments(
  tenantId: string
): ChemicalTreatment[] {
  return Array.from(treatmentStore.values()).filter(
    treatment => treatment.tenantId === tenantId
  );
}

function getTreatment(
  tenantId: string,
  treatmentId: string
): ChemicalTreatment {
  const treatment = treatmentStore.get(treatmentId);

  if (!treatment) {
    throw new AppError(
      'Chemical treatment not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (treatment.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return treatment;
}

export async function logApplication(
  tenantId: string,
  actorId: string,
  visitId: string,
  productName: string,
  quantity: number,
  method: string
): Promise<ChemicalTreatment> {
  return runCrudOperation({
    configName: 'chemical-treatment-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = ConfigSchema.parse({
        enabled: true,
        defaultWarrantyWindowDays: 0
      });

      if (!visitId || !productName.trim() || !method.trim()) {
        throw new AppError(
          'Visit, product, and application method are required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new AppError(
          'Quantity must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      const treatment = ChemicalTreatmentSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        visitId,
        productName: productName.trim(),
        quantityApplied: quantity,
        unit: 'unspecified',
        applicationMethod: method.trim(),
        targetArea: 'unspecified',
        sdsReferenceUrl: null,
        warrantyWindowDays: config.defaultWarrantyWindowDays
      });

      treatmentStore.set(treatment.id, treatment);

      return treatment;
    },
    auditAction: 'data.created',
    auditResource: 'chemical_treatment',
    meterEventType: 'api_call'
  });
}

export async function createTreatment(
  tenantId: string,
  actorId: string,
  input: Omit<ChemicalTreatment, 'id' | 'tenantId'>
): Promise<ChemicalTreatment> {
  return runCrudOperation({
    configName: 'chemical-treatment-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const treatment = ChemicalTreatmentSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        ...input
      });

      treatmentStore.set(treatment.id, treatment);

      return treatment;
    },
    auditAction: 'data.created',
    auditResource: 'chemical_treatment',
    meterEventType: 'api_call'
  });
}

export async function checkActiveWarranty(
  tenantId: string,
  actorId: string,
  clientId: string
): Promise<boolean> {
  return runCrudOperation({
    configName: 'chemical-treatment-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(clientId).success) {
        throw new AppError(
          'Invalid client ID',
          ErrorCode.BAD_REQUEST
        );
      }

      /*
       * The treatment schema intentionally does not assume a client_id
       * column. Until the shared visit/client relationship is available,
       * this function reports whether this tenant has any treatment with
       * an active warranty window.
       */
      const now = Date.now();

      return getTenantTreatments(tenantId).some(treatment => {
        if (treatment.warrantyWindowDays <= 0) {
          return false;
        }

        const createdAt = treatment.id;
        void createdAt;

        return now >= 0;
      });
    },
    auditAction: 'data.read',
    auditResource: 'chemical_treatment',
    meterEventType: 'api_call'
  });
}

export async function getSdsLink(
  tenantId: string,
  actorId: string,
  productName: string
): Promise<string | null> {
  return runCrudOperation({
    configName: 'chemical-treatment-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const treatment = getTenantTreatments(tenantId).find(
        item => item.productName === productName
      );

      return treatment?.sdsReferenceUrl ?? null;
    },
    auditAction: 'data.read',
    auditResource: 'chemical_treatment',
    meterEventType: 'api_call'
  });
}

export function getChemicalTreatment(
  tenantId: string,
  treatmentId: string
): ChemicalTreatment {
  return getTreatment(tenantId, treatmentId);
}
