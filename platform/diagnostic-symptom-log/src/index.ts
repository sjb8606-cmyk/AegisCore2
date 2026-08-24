import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const DiagnosisSchema = z.object({
  diagnosisId: z.string().uuid(),
  tenantId: z.string().uuid(),
  jobId: z.string().uuid(),
  applianceId: z.string().uuid(),
  reportedSymptoms: z.string().min(1),
  diagnosedIssue: z.string().nullable(),
  repairRecommended: z.boolean(),
  replacementRecommended: z.boolean(),
  createdAt: z.string().datetime()
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;

const diagnosisStore = new Map<string, Diagnosis>();

export function __resetDiagnosticSymptomLogStore(): void {
  diagnosisStore.clear();
}

export async function logSymptoms(
  tenantId: string,
  actorId: string,
  jobId: string,
  applianceId: string,
  reportedSymptoms: string
): Promise<Diagnosis> {
  return runCrudOperation({
    configName: 'diagnostic-symptom-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!reportedSymptoms.trim()) {
        throw new AppError(
          'Reported symptoms are required',
          ErrorCode.BAD_REQUEST
        );
      }

      const diagnosis = DiagnosisSchema.parse({
        diagnosisId: crypto.randomUUID(),
        tenantId,
        jobId,
        applianceId,
        reportedSymptoms: reportedSymptoms.trim(),
        diagnosedIssue: null,
        repairRecommended: false,
        replacementRecommended: false,
        createdAt: new Date().toISOString()
      });

      diagnosisStore.set(
        diagnosis.diagnosisId,
        diagnosis
      );

      return diagnosis;
    },
    auditAction: 'data.created',
    auditResource: 'diagnostic_symptom_log',
    meterEventType: 'api_call'
  });
}

export async function recordDiagnosis(
  tenantId: string,
  actorId: string,
  diagnosisId: string,
  diagnosedIssue: string,
  recommendation: {
    repairRecommended: boolean;
    replacementRecommended: boolean;
  }
): Promise<Diagnosis> {
  return runCrudOperation({
    configName: 'diagnostic-symptom-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const existing = diagnosisStore.get(diagnosisId);

      if (!existing) {
        throw new AppError(
          'Diagnosis not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (existing.tenantId !== tenantId) {
        throw new AppError(
          'Diagnosis does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      if (!diagnosedIssue.trim()) {
        throw new AppError(
          'Diagnosed issue is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const updated = DiagnosisSchema.parse({
        ...existing,
        diagnosedIssue: diagnosedIssue.trim(),
        repairRecommended:
          recommendation.repairRecommended,
        replacementRecommended:
          recommendation.replacementRecommended
      });

      diagnosisStore.set(diagnosisId, updated);

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'diagnostic_symptom_log',
    meterEventType: 'api_call'
  });
}

export async function getDiagnosisHistory(
  tenantId: string,
  actorId: string,
  applianceId: string
): Promise<Diagnosis[]> {
  return runCrudOperation({
    configName: 'diagnostic-symptom-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!applianceId.trim()) {
        throw new AppError(
          'Appliance ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      return Array.from(diagnosisStore.values())
        .filter(
          diagnosis =>
            diagnosis.tenantId === tenantId &&
            diagnosis.applianceId === applianceId
        );
    },
    auditAction: 'data.read',
    auditResource: 'diagnostic_symptom_log',
    meterEventType: 'api_call'
  });
}
