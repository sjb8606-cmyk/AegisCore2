import * as crypto from 'crypto';
import {
  runCrudOperation,
  AppError,
  ErrorCode
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

const ConfigSchema = {
  safeParse(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: new Error('Invalid configuration')
      };
    }

    return {
      success: true,
      data: value
    };
  }
};

function validateDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      field + ' must be a valid date'
    );
  }
}

function getEvent(eventId: string): EventTimeline {
  const event = store.get(eventId);

  if (!event) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Event timeline not found'
    );
  }

  return event;
}

export async function createEvent(
  tenantId: string,
  actorId: string,
  clientId: string,
  eventDate: string
): Promise<EventTimeline> {
  if (!clientId.trim()) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'clientId is required'
    );
  }

  validateDate(eventDate, 'eventDate');

  const event: EventTimeline = {
    eventId: crypto.randomUUID(),
    clientId,
    eventDate,
    vendors: [],
    overallStatus: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'create',
    auditAction: 'data.created',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(event.eventId, event);
      return event;
    }
  });
}

export async function addVendor(
  tenantId: string,
  actorId: string,
  eventId: string,
  vendorData: Vendor
): Promise<EventTimeline> {
  if (!vendorData.vendorName.trim()) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'vendorName is required'
    );
  }

  if (!vendorData.vendorRole.trim()) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      'vendorRole is required'
    );
  }

  validateDate(vendorData.deadline, 'deadline');

  const event = getEvent(eventId);

  if (
    event.vendors.some(
      (vendor) => vendor.vendorName === vendorData.vendorName
    )
  ) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Vendor already exists for this event'
    );
  }

  const updated: EventTimeline = {
    ...event,
    vendors: [...event.vendors, vendorData],
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(eventId, updated);
      return updated;
    }
  });
}

export async function updateVendorStatus(
  tenantId: string,
  actorId: string,
  eventId: string,
  vendorName: string,
  status: VendorStatus
): Promise<EventTimeline> {
  const event = getEvent(eventId);

  const found = event.vendors.some(
    (vendor) => vendor.vendorName === vendorName
  );

  if (!found) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      'Vendor not found'
    );
  }

  const updated: EventTimeline = {
    ...event,
    vendors: event.vendors.map((vendor) =>
      vendor.vendorName === vendorName
        ? { ...vendor, status }
        : vendor
    ),
    updatedAt: new Date().toISOString()
  };

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    actionFn: async () => {
      store.set(eventId, updated);
      return updated;
    }
  });
}

export async function getUpcomingDeadlines(
  tenantId: string,
  actorId: string,
  eventId: string
): Promise<Vendor[]> {
  const event = getEvent(eventId);
  const now = Date.now();

  return runCrudOperation({
    configName: 'event-project-timeline',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'read',
    auditAction: 'data.read',
    auditResource: 'event-project-timeline',
    meterEventType: 'api_call',
    actionFn: async () =>
      event.vendors
        .filter((vendor) => Date.parse(vendor.deadline) >= now)
        .sort(
          (a, b) =>
            Date.parse(a.deadline) - Date.parse(b.deadline)
        )
  });
}

export function __resetEventProjectTimelineStore(): void {
  store.clear();
}
