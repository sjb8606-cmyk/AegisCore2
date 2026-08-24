import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('recurring-route-scheduling');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z.object({
    maxVisitsPerContract: z.number().int().positive().default(1000)
  }).default({
    maxVisitsPerContract: 1000
  })
});

export type Config = z.infer<typeof ConfigSchema>;

export const FrequencySchema = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'seasonal'
]);

export const StatusSchema = z.enum([
  'active',
  'paused',
  'cancelled'
]);

export const VisitStatusSchema = z.enum([
  'scheduled',
  'skipped',
  'completed'
]);

export const RecurringRouteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  contractId: z.string().uuid(),
  frequency: FrequencySchema,
  nextVisitDate: z.coerce.date(),
  routeGroupId: z.string().uuid().nullable(),
  status: StatusSchema
});

export type RecurringRoute = z.infer<typeof RecurringRouteSchema>;

export const VisitSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  contractId: z.string().uuid(),
  scheduledDate: z.coerce.date(),
  routeOrder: z.number().int().positive().nullable(),
  status: VisitStatusSchema
});

export type Visit = z.infer<typeof VisitSchema>;

const routeStore = new Map<string, RecurringRoute>();
const visitStore = new Map<string, Visit>();

export function __resetRecurringRouteSchedulingStore(): void {
  routeStore.clear();
  visitStore.clear();
}

function getConfig(): Config {
  return loadConfig('recurring-route-scheduling', ConfigSchema);
}

function nextRecurrence(
  date: Date,
  frequency: z.infer<typeof FrequencySchema>
): Date {
  const next = new Date(date);

  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'seasonal':
      next.setMonth(next.getMonth() + 3);
      break;
  }

  return next;
}

function findRouteByContractId(
  tenantId: string,
  contractId: string
): RecurringRoute {
  const route = routeStore.get(contractId);

  if (!route) {
    throw new AppError(
      'Recurring contract not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (route.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return route;
}

function findVisit(
  tenantId: string,
  visitId: string
): Visit {
  const visit = visitStore.get(visitId);

  if (!visit) {
    throw new AppError('Visit not found', ErrorCode.NOT_FOUND);
  }

  if (visit.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return visit;
}

export async function createRecurringRoute(
  tenantId: string,
  actorId: string,
  input: Omit<RecurringRoute, 'id' | 'tenantId'>
): Promise<RecurringRoute> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const existing = routeStore.get(input.contractId);

      if (existing && existing.tenantId === tenantId) {
        throw new AppError(
          'Recurring contract already exists',
          ErrorCode.CONFLICT
        );
      }

      const route: RecurringRoute = RecurringRouteSchema.parse({
        id: crypto.randomUUID(),
        tenantId,
        ...input
      });

      routeStore.set(route.contractId, route);
      return route;
    },
    auditAction: 'data.created',
    auditResource: 'recurring_route_contract',
    meterEventType: 'api_call'
  });
}

export async function generateNextVisit(
  tenantId: string,
  actorId: string,
  contractId: string
): Promise<Visit> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();
      const route = findRouteByContractId(tenantId, contractId);

      const visitCount = Array.from(visitStore.values()).filter(
        visit =>
          visit.tenantId === tenantId &&
          visit.contractId === contractId
      ).length;

      if (visitCount >= config.limits.maxVisitsPerContract) {
        throw new AppError(
          'Visit limit reached for contract',
          ErrorCode.RATE_LIMITED
        );
      }

      if (route.status !== 'active') {
        throw new AppError(
          'Cannot generate a visit for an inactive contract',
          ErrorCode.CONFLICT
        );
      }

      const visit: Visit = {
        id: crypto.randomUUID(),
        tenantId,
        contractId,
        scheduledDate: new Date(route.nextVisitDate),
        routeOrder: null,
        status: 'scheduled'
      };

      visitStore.set(visit.id, visit);

      route.nextVisitDate = nextRecurrence(
        route.nextVisitDate,
        route.frequency
      );

      routeStore.set(route.contractId, route);

      logger.info('Generated recurring route visit', {
        tenantId,
        contractId,
        visitId: visit.id
      });

      return visit;
    },
    auditAction: 'data.created',
    auditResource: 'recurring_route_visit',
    meterEventType: 'api_call'
  });
}

export async function rescheduleVisit(
  tenantId: string,
  actorId: string,
  visitId: string,
  newDate: Date
): Promise<Visit> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const parsedDate = z.coerce.date().safeParse(newDate);

      if (!parsedDate.success) {
        throw new AppError(
          'Invalid visit date',
          ErrorCode.BAD_REQUEST
        );
      }

      const visit = findVisit(tenantId, visitId);

      visit.scheduledDate = parsedDate.data;
      visit.routeOrder = null;

      visitStore.set(visit.id, visit);

      return visit;
    },
    auditAction: 'data.updated',
    auditResource: 'recurring_route_visit',
    meterEventType: 'api_call'
  });
}

export async function assignRouteOrder(
  tenantId: string,
  actorId: string,
  technicianId: string,
  date: Date
): Promise<Visit[]> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      void technicianId;

      const targetDate = z.coerce.date().parse(date);
      const target = targetDate.toISOString().slice(0, 10);

      const visits = Array.from(visitStore.values())
        .filter(
          visit =>
            visit.tenantId === tenantId &&
            visit.status === 'scheduled' &&
            visit.scheduledDate.toISOString().slice(0, 10) === target
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      visits.forEach((visit, index) => {
        visit.routeOrder = index + 1;
        visitStore.set(visit.id, visit);
      });

      return visits;
    },
    auditAction: 'data.updated',
    auditResource: 'recurring_route_visit',
    meterEventType: 'api_call'
  });
}

export async function skipVisit(
  tenantId: string,
  actorId: string,
  visitId: string,
  reason: string
): Promise<Visit> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!reason.trim()) {
        throw new AppError(
          'Skip reason is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const visit = findVisit(tenantId, visitId);

      visit.status = 'skipped';
      visit.routeOrder = null;

      visitStore.set(visit.id, visit);

      return visit;
    },
    auditAction: 'data.updated',
    auditResource: 'recurring_route_visit',
    meterEventType: 'api_call'
  });
}

export async function getRecurringRoute(
  tenantId: string,
  actorId: string,
  contractId: string
): Promise<RecurringRoute> {
  return runCrudOperation({
    configName: 'recurring-route-scheduling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => findRouteByContractId(tenantId, contractId),
    auditAction: 'data.read',
    auditResource: 'recurring_route_contract',
    meterEventType: 'api_call'
  });
}
