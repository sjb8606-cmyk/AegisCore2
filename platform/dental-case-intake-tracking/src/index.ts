import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger(
  'dental-case-intake-tracking'
);

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

export type CaseType =
  | 'crown'
  | 'denture'
  | 'implant'
  | 'bridge'
  | 'other';

export type ProductionStage =
  | 'intake'
  | 'design'
  | 'milling_fabrication'
  | 'quality_check'
  | 'shipped';

export interface DentalCase {
  case_id: string;
  tenant_id: string;
  dentist_client_id: string;
  patient_reference: string;
  case_type: CaseType;
  intake_date: string;
  due_date: string;
  production_stage: ProductionStage;
  rush_order: boolean;
  created_at: string;
  updated_at: string;
}

const caseStore =
  new Map<string, DentalCase>();

export function __resetDentalCaseIntakeTrackingStore(): void {
  caseStore.clear();
}

function getConfig() {
  return loadConfig(
    'dental-case-intake-tracking',
    ConfigSchema
  );
}

const stageOrder: ProductionStage[] = [
  'intake',
  'design',
  'milling_fabrication',
  'quality_check',
  'shipped'
];

function validateDate(
  value: string,
  field: string
): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      `${field} must be a valid date`
    );
  }

  return date;
}

export async function createCase(
  tenantId: string,
  actorId: string,
  dentistClientId: string,
  patientReference: string,
  caseType: CaseType,
  dueDate: string,
  rushOrder = false
): Promise<DentalCase> {
  return runCrudOperation({
    configName: 'dental-case-intake-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Dental case intake tracking is disabled'
        );
      }

      if (!dentistClientId.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Dentist client ID is required'
        );
      }

      if (!patientReference.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Patient reference is required'
        );
      }

      if (!dueDate.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Due date is required'
        );
      }

      validateDate(
        dueDate,
        'Due date'
      );

      const now =
        new Date().toISOString();

      const record: DentalCase = {
        case_id: crypto.randomUUID(),
        tenant_id: tenantId,
        dentist_client_id:
          dentistClientId,
        patient_reference:
          patientReference,
        case_type: caseType,
        intake_date: now,
        due_date: dueDate,
        production_stage: 'intake',
        rush_order: rushOrder,
        created_at: now,
        updated_at: now
      };

      caseStore.set(
        record.case_id,
        record
      );

      logger.info(
        'Dental case created',
        {
          tenantId,
          caseId: record.case_id,
          caseType,
          rushOrder
        }
      );

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'dental_case',
    meterEventType: 'api_call'
  });
}

export async function advanceStage(
  tenantId: string,
  actorId: string,
  caseId: string,
  newStage: ProductionStage
): Promise<DentalCase> {
  return runCrudOperation({
    configName: 'dental-case-intake-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record =
        caseStore.get(caseId);

      if (
        !record ||
        record.tenant_id !== tenantId
      ) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Dental case not found'
        );
      }

      const currentIndex =
        stageOrder.indexOf(
          record.production_stage
        );

      const newIndex =
        stageOrder.indexOf(newStage);

      if (newIndex === -1) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Invalid production stage'
        );
      }

      if (newIndex < currentIndex) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Production stage cannot move backward'
        );
      }

      if (
        newIndex === currentIndex
      ) {
        return record;
      }

      const updated: DentalCase = {
        ...record,
        production_stage: newStage,
        updated_at:
          new Date().toISOString()
      };

      caseStore.set(
        caseId,
        updated
      );

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'dental_case',
    meterEventType: 'api_call'
  });
}

export async function flagOverdueCases(
  tenantId: string,
  actorId: string,
  daysAhead = 0
): Promise<DentalCase[]> {
  return runCrudOperation({
    configName: 'dental-case-intake-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isFinite(daysAhead) ||
        daysAhead < 0
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Days ahead must be zero or greater'
        );
      }

      const cutoff =
        new Date(
          Date.now() +
          daysAhead * 24 * 60 * 60 * 1000
        );

      return Array.from(
        caseStore.values()
      ).filter(record => {
        if (
          record.tenant_id !== tenantId
        ) {
          return false;
        }

        if (
          record.production_stage ===
          'shipped'
        ) {
          return false;
        }

        const due =
          new Date(record.due_date);

        return due <= cutoff;
      });
    },
    auditAction: 'data.read',
    auditResource: 'dental_case',
    meterEventType: 'api_call'
  });
}

export function getCase(
  tenantId: string,
  caseId: string
): DentalCase | undefined {
  const record =
    caseStore.get(caseId);

  if (
    !record ||
    record.tenant_id !== tenantId
  ) {
    return undefined;
  }

  return record;
}
