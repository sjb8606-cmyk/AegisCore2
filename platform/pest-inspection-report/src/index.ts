import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  severityLevels: z.array(
    z.enum([
      'low',
      'moderate',
      'high',
      'infestation'
    ])
  ).default([
    'low',
    'moderate',
    'high',
    'infestation'
  ])
});

export const PestInspectionReportSchema = z.object({
  reportId: z.string().uuid(),
  tenantId: z.string().uuid(),
  visitId: z.string().uuid(),
  pestType: z.string().min(1).max(200),
  severity: z.enum([
    'low',
    'moderate',
    'high',
    'infestation'
  ]),
  locationsFound: z.array(z.string().min(1).max(500)),
  recommendedTreatmentPlan: z.string().min(1),
  followUpRequired: z.boolean(),
  followUpDate: z.coerce.date().nullable()
});

export type PestInspectionReport = z.infer<
  typeof PestInspectionReportSchema
>;

const reportStore = new Map<
  string,
  PestInspectionReport
>();

export function __resetPestInspectionReportStore(): void {
  reportStore.clear();
}

function getReport(
  tenantId: string,
  reportId: string
): PestInspectionReport {
  const report = reportStore.get(reportId);

  if (!report) {
    throw new AppError(
      'Pest inspection report not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (report.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return report;
}

export function generateTreatmentRecommendation(
  pestType: string,
  severity: PestInspectionReport['severity']
): string {
  const normalized = pestType.trim();

  if (!normalized) {
    throw new AppError(
      'Pest type is required',
      ErrorCode.BAD_REQUEST
    );
  }

  const severityGuidance: Record<
    PestInspectionReport['severity'],
    string
  > = {
    low: 'Monitor activity and perform targeted treatment as appropriate.',
    moderate: 'Perform targeted treatment and schedule a follow-up inspection.',
    high: 'Prioritize treatment and schedule a prompt follow-up inspection.',
    infestation: 'Initiate an immediate comprehensive treatment plan and mandatory follow-up.'
  };

  return (
    'Pest: ' +
    normalized +
    '. ' +
    severityGuidance[severity]
  );
}

export async function createReport(
  tenantId: string,
  actorId: string,
  visitId: string,
  pestType: string,
  severity: PestInspectionReport['severity'],
  locationsFound: string[]
): Promise<PestInspectionReport> {
  return runCrudOperation({
    configName: 'pest-inspection-report',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!z.string().uuid().safeParse(visitId).success) {
        throw new AppError(
          'Invalid visit ID',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!pestType.trim()) {
        throw new AppError(
          'Pest type is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (locationsFound.length === 0) {
        throw new AppError(
          'At least one location is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const report =
        PestInspectionReportSchema.parse({
          reportId: crypto.randomUUID(),
          tenantId,
          visitId,
          pestType: pestType.trim(),
          severity,
          locationsFound,
          recommendedTreatmentPlan:
            generateTreatmentRecommendation(
              pestType,
              severity
            ),
          followUpRequired:
            severity === 'moderate' ||
            severity === 'high' ||
            severity === 'infestation',
          followUpDate: null
        });

      reportStore.set(
        report.reportId,
        report
      );

      return report;
    },
    auditAction: 'data.created',
    auditResource: 'pest_inspection_report',
    meterEventType: 'api_call'
  });
}

export async function scheduleFollowUp(
  tenantId: string,
  actorId: string,
  reportId: string,
  date: Date
): Promise<PestInspectionReport> {
  return runCrudOperation({
    configName: 'pest-inspection-report',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (Number.isNaN(date.getTime())) {
        throw new AppError(
          'Invalid follow-up date',
          ErrorCode.BAD_REQUEST
        );
      }

      const report = getReport(
        tenantId,
        reportId
      );

      report.followUpRequired = true;
      report.followUpDate = date;

      reportStore.set(
        report.reportId,
        report
      );

      return report;
    },
    auditAction: 'data.updated',
    auditResource: 'pest_inspection_report',
    meterEventType: 'api_call'
  });
}

export async function getReportById(
  tenantId: string,
  actorId: string,
  reportId: string
): Promise<PestInspectionReport> {
  return runCrudOperation({
    configName: 'pest-inspection-report',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getReport(
        tenantId,
        reportId
      ),
    auditAction: 'data.read',
    auditResource: 'pest_inspection_report',
    meterEventType: 'api_call'
  });
}
