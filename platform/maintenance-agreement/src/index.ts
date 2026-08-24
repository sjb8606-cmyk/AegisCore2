import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultVisitsPerYear: z.number().int().positive().default(2),
  renewalWarningDays: z.number().int().nonnegative().default(30)
});

export const MaintenanceAgreementSchema = z.object({
  agreementId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  equipmentCovered: z.array(z.string()).default([]),
  visitsPerYear: z.number().int().positive(),
  visitsCompletedThisCycle: z.number().int().nonnegative(),
  renewalDate: z.coerce.date(),
  priorityResponse: z.boolean()
});

export type MaintenanceAgreement = z.infer<
  typeof MaintenanceAgreementSchema
>;

const agreementStore = new Map<
  string,
  MaintenanceAgreement
>();

export function __resetMaintenanceAgreementStore(): void {
  agreementStore.clear();
}

function getAgreement(
  tenantId: string,
  agreementId: string
): MaintenanceAgreement {
  const agreement = agreementStore.get(agreementId);

  if (!agreement) {
    throw new AppError(
      'Maintenance agreement not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (agreement.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return agreement;
}

export async function createMaintenanceAgreement(
  tenantId: string,
  actorId: string,
  clientId: string,
  equipmentCovered: string[],
  visitsPerYear: number,
  renewalDate: Date,
  priorityResponse: boolean
): Promise<MaintenanceAgreement> {
  return runCrudOperation({
    configName: 'maintenance-agreement',
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

      if (
        !Number.isInteger(visitsPerYear) ||
        visitsPerYear <= 0
      ) {
        throw new AppError(
          'Visits per year must be a positive integer',
          ErrorCode.BAD_REQUEST
        );
      }

      if (
        !(renewalDate instanceof Date) ||
        Number.isNaN(renewalDate.getTime())
      ) {
        throw new AppError(
          'Invalid renewal date',
          ErrorCode.BAD_REQUEST
        );
      }

      const agreement =
        MaintenanceAgreementSchema.parse({
          agreementId: crypto.randomUUID(),
          tenantId,
          clientId,
          equipmentCovered,
          visitsPerYear,
          visitsCompletedThisCycle: 0,
          renewalDate,
          priorityResponse
        });

      agreementStore.set(
        agreement.agreementId,
        agreement
      );

      return agreement;
    },
    auditAction: 'data.created',
    auditResource: 'maintenance_agreement',
    meterEventType: 'api_call'
  });
}

export async function scheduleAnnualVisits(
  tenantId: string,
  actorId: string,
  agreementId: string
): Promise<Date[]> {
  return runCrudOperation({
    configName: 'maintenance-agreement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const agreement = getAgreement(
        tenantId,
        agreementId
      );

      const renewal = new Date(
        agreement.renewalDate
      );

      const intervalMonths =
        12 / agreement.visitsPerYear;

      const dates: Date[] = [];

      for (
        let i = 0;
        i < agreement.visitsPerYear;
        i++
      ) {
        const visitDate = new Date(renewal);
        visitDate.setMonth(
          visitDate.getMonth() +
            i * intervalMonths
        );
        dates.push(visitDate);
      }

      return dates;
    },
    auditAction: 'data.read',
    auditResource: 'maintenance_agreement',
    meterEventType: 'api_call'
  });
}

export async function logVisitCompleted(
  tenantId: string,
  actorId: string,
  agreementId: string
): Promise<MaintenanceAgreement> {
  return runCrudOperation({
    configName: 'maintenance-agreement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const agreement = getAgreement(
        tenantId,
        agreementId
      );

      if (
        agreement.visitsCompletedThisCycle >=
        agreement.visitsPerYear
      ) {
        throw new AppError(
          'All agreement visits for this cycle are already completed',
          ErrorCode.CONFLICT
        );
      }

      agreement.visitsCompletedThisCycle += 1;

      agreementStore.set(
        agreement.agreementId,
        agreement
      );

      return agreement;
    },
    auditAction: 'data.updated',
    auditResource: 'maintenance_agreement',
    meterEventType: 'api_call'
  });
}

export async function checkRenewalDue(
  tenantId: string,
  actorId: string,
  daysAhead: number
): Promise<MaintenanceAgreement[]> {
  return runCrudOperation({
    configName: 'maintenance-agreement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
      ) {
        throw new AppError(
          'Days ahead must be a non-negative integer',
          ErrorCode.BAD_REQUEST
        );
      }

      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(
        cutoff.getDate() + daysAhead
      );

      return Array.from(
        agreementStore.values()
      ).filter(agreement => {
        if (agreement.tenantId !== tenantId) {
          return false;
        }

        return (
          agreement.renewalDate >= now &&
          agreement.renewalDate <= cutoff
        );
      });
    },
    auditAction: 'data.read',
    auditResource: 'maintenance_agreement',
    meterEventType: 'api_call'
  });
}

export async function getMaintenanceAgreement(
  tenantId: string,
  actorId: string,
  agreementId: string
): Promise<MaintenanceAgreement> {
  return runCrudOperation({
    configName: 'maintenance-agreement',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      getAgreement(
        tenantId,
        agreementId
      ),
    auditAction: 'data.read',
    auditResource: 'maintenance_agreement',
    meterEventType: 'api_call'
  });
}
