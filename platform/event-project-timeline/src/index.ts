import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
} from '@platform/crud-kernel';

export type VendorStatus = 'pending' | 'confirmed' | 'completed';

export type Vendor = {
  vendorName: string;
  vendorRole: string;
  deadline: string;
  status: VendorStatus;
};

export type OverallStatus =
  | 'planning'
  | 'confirmed'
  | 'in_progress'
  | 'completed';

export type EventTimeline = {
  eventId: string;
  clientId: string;
  eventDate: string;
  vendors: Vendor[];
  overallStatus: OverallStatus;
  createdAt: string;
  updatedAt: string;
};

const store = new Map<string, EventTimeline>();

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      apiCallsPerMonth: z.number().default(10000),
    })
    .default({ apiCallsPerMonth: 10000 }),
  features: z
    .object({
      vendorTracking: z.boolean().default(true),
      deadlineTracking: z.boolean().default(true),
    })
    .default({
      vendorTracking: true,
      deadlineTracking: true,
    }),
});

function validateDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(
      `${field} must be a valid date`,
      ErrorCode.BAD_REQUEST,
    );
  }
}

function getEvent(eventId: string): EventTimeline {
  const event = store.get(eventId);
  if (!event) {
    throw new AppError(
      'Event timeline not found',
      ErrorCode.NOT_FOUND,
    );
  }
  return event;
}

export async function createEvent(
  tenantId: string,
  actorId: string,
  clientId: string,
  eventDate: string,
): Promise<EventTimeline> {
  if (!clientId.trim()) {
    throw new AppError('clientId is required', ErrorCode.BAD_REQUEST);
  }
  validateDate(eventDate, 'eventDate');

  const event: EventTimeline = {
    eventId: crypto.randomUUID(),
    clientId,
    eventDate,
    vendors: [],
    overallStatus: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.created',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    action: async () => {
      store.set(event.eventId, event);
      return event;
    },
  });
}

export async function addVendor(
  tenantId: string,
  actorId: string,
  eventId: string,
  vendorData: Vendor,
): Promise<EventTimeline> {
  if (!vendorData.vendorName.trim()) {
    throw new AppError('vendorName is required', ErrorCode.BAD_REQUEST);
  }
  if (!vendorData.vendorRole.trim()) {
    throw new AppError('vendorRole is required', ErrorCode.BAD_REQUEST);
  }
  validateDate(vendorData.deadline, 'deadline');

  const event = getEvent(eventId);

  if (event.vendors.some((v) => v.vendorName === vendorData.vendorName)) {
    throw new AppError(
      'Vendor already exists for this event',
      ErrorCode.CONFLICT,
    );
  }

  const updated: EventTimeline = {
    ...event,
    vendors: [...event.vendors, vendorData],
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    action: async () => {
      store.set(eventId, updated);
      return updated;
    },
  });
}

export async function updateVendorStatus(
  tenantId: string,
  actorId: string,
  eventId: string,
  vendorName: string,
  status: VendorStatus,
): Promise<EventTimeline> {
  const event = getEvent(eventId);

  if (!event.vendors.some((v) => v.vendorName === vendorName)) {
    throw new AppError('Vendor not found', ErrorCode.NOT_FOUND);
  }

  const updated: EventTimeline = {
    ...event,
    vendors: event.vendors.map((v) =>
      v.vendorName === vendorName ? { ...v, status } : v,
    ),
    updatedAt: new Date().toISOString(),
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    action: async () => {
      store.set(eventId, updated);
      return updated;
    },
  });
}

export async function getUpcomingDeadlines(
  tenantId: string,
  actorId: string,
  eventId: string,
): Promise<Vendor[]> {
  const event = getEvent(eventId);
  const now = Date.now();

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    action: async () =>
      event.vendors
        .filter((v) => Date.parse(v.deadline) >= now)
        .sort(
          (a, b) => Date.parse(a.deadline) - Date.parse(b.deadline),
        ),
  });
}

export function __resetEventProjectTimelineStore(): void {
  store.clear();
}
