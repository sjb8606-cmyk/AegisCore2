import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('gate-access-control-integration');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

type AccessStatus =
  | 'active'
  | 'suspended_nonpayment'
  | 'revoked';

export interface AccessRecord {
  access_id: string;
  tenant_id: string;
  tenant_holder_id: string;
  unit_id: string;
  access_code: string;
  access_status: AccessStatus;
  last_entry_timestamp?: string;
  created_at: string;
  updated_at: string;
}

export interface AccessEntryEvent {
  event_id: string;
  tenant_id: string;
  tenant_holder_id: string;
  timestamp: string;
}

const accessStore = new Map<string, AccessRecord>();
const entryStore = new Map<string, AccessEntryEvent>();

export function __resetGateAccessControlIntegrationStore(): void {
  accessStore.clear();
  entryStore.clear();
}

function getConfig() {
  return loadConfig('gate-access-control-integration', ConfigSchema);
}

export async function grantAccess(
  tenantId: string,
  actorId: string,
  tenantHolderId: string,
  unitId: string,
  accessCode: string
): Promise<AccessRecord> {
  return runCrudOperation({
    configName: 'gate-access-control-integration',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Gate access control integration is disabled'
        );
      }

      if (!accessCode.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Access code is required'
        );
      }

      const existing = Array.from(accessStore.values()).find(
        (record) =>
          record.tenant_id === tenantId &&
          record.tenant_holder_id === tenantHolderId &&
          record.unit_id === unitId
      );

      const now = new Date().toISOString();

      if (existing) {
        const updated: AccessRecord = {
          ...existing,
          access_code: accessCode,
          access_status: 'active',
          updated_at: now
        };

        accessStore.set(existing.access_id, updated);
        return updated;
      }

      const record: AccessRecord = {
        access_id: crypto.randomUUID(),
        tenant_id: tenantId,
        tenant_holder_id: tenantHolderId,
        unit_id: unitId,
        access_code: accessCode,
        access_status: 'active',
        created_at: now,
        updated_at: now
      };

      accessStore.set(record.access_id, record);

      logger.info('Gate access granted', {
        tenantId,
        tenantHolderId,
        unitId
      });

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'gate_access',
    meterEventType: 'api_call'
  });
}

export async function suspendAccessForNonpayment(
  tenantId: string,
  actorId: string,
  tenantHolderId: string
): Promise<AccessRecord[]> {
  return runCrudOperation({
    configName: 'gate-access-control-integration',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const records = Array.from(accessStore.values()).filter(
        (record) =>
          record.tenant_id === tenantId &&
          record.tenant_holder_id === tenantHolderId
      );

      if (records.length === 0) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'No gate access record found'
        );
      }

      const now = new Date().toISOString();

      const updatedRecords = records.map((record) => {
        const updated: AccessRecord = {
          ...record,
          access_status: 'suspended_nonpayment',
          updated_at: now
        };

        accessStore.set(record.access_id, updated);
        return updated;
      });

      return updatedRecords;
    },
    auditAction: 'data.updated',
    auditResource: 'gate_access',
    meterEventType: 'api_call'
  });
}

export async function logEntryEvent(
  tenantId: string,
  actorId: string,
  tenantHolderId: string,
  timestamp: string
): Promise<AccessEntryEvent> {
  return runCrudOperation({
    configName: 'gate-access-control-integration',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const access = Array.from(accessStore.values()).find(
        (record) =>
          record.tenant_id === tenantId &&
          record.tenant_holder_id === tenantHolderId &&
          record.access_status === 'active'
      );

      if (!access) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Active gate access not found'
        );
      }

      const event: AccessEntryEvent = {
        event_id: crypto.randomUUID(),
        tenant_id: tenantId,
        tenant_holder_id: tenantHolderId,
        timestamp
      };

      entryStore.set(event.event_id, event);

      const updated: AccessRecord = {
        ...access,
        last_entry_timestamp: timestamp,
        updated_at: new Date().toISOString()
      };

      accessStore.set(access.access_id, updated);

      return event;
    },
    auditAction: 'data.created',
    auditResource: 'gate_entry_event',
    meterEventType: 'api_call'
  });
}

export function getAccessRecord(
  tenantId: string,
  tenantHolderId: string,
  unitId: string
): AccessRecord | undefined {
  return Array.from(accessStore.values()).find(
    (record) =>
      record.tenant_id === tenantId &&
      record.tenant_holder_id === tenantHolderId &&
      record.unit_id === unitId
  );
}
