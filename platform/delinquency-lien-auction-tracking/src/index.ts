import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('delinquency-lien-auction-tracking');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

export type DelinquencyStatus =
  | 'current'
  | 'late'
  | 'lien_filed'
  | 'auction_scheduled'
  | 'resolved';

export interface DelinquencyRecord {
  delinquency_id: string;
  tenant_id: string;
  tenant_holder_id: string;
  unit_id: string;
  days_overdue: number;
  lien_filed_date?: string;
  auction_scheduled_date?: string;
  status: DelinquencyStatus;
  created_at: string;
  updated_at: string;
}

const delinquencyStore =
  new Map<string, DelinquencyRecord>();

export function __resetDelinquencyLienAuctionTrackingStore(): void {
  delinquencyStore.clear();
}

function getConfig() {
  return loadConfig(
    'delinquency-lien-auction-tracking',
    ConfigSchema
  );
}

function getKey(
  tenantId: string,
  tenantHolderId: string,
  unitId: string
): string {
  return `${tenantId}:${tenantHolderId}:${unitId}`;
}

export async function flagDelinquent(
  tenantId: string,
  actorId: string,
  tenantHolderId: string,
  unitId: string,
  daysOverdue: number
): Promise<DelinquencyRecord> {
  return runCrudOperation({
    configName: 'delinquency-lien-auction-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Delinquency tracking is disabled'
        );
      }

      if (!Number.isInteger(daysOverdue) || daysOverdue < 1) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Days overdue must be a positive integer'
        );
      }

      const key = getKey(
        tenantId,
        tenantHolderId,
        unitId
      );

      const existing = delinquencyStore.get(key);
      const now = new Date().toISOString();

      const record: DelinquencyRecord = {
        delinquency_id:
          existing?.delinquency_id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        tenant_holder_id: tenantHolderId,
        unit_id: unitId,
        days_overdue: daysOverdue,
        lien_filed_date: existing?.lien_filed_date,
        auction_scheduled_date:
          existing?.auction_scheduled_date,
        status:
          existing?.status === 'lien_filed' ||
          existing?.status === 'auction_scheduled'
            ? existing.status
            : 'late',
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      delinquencyStore.set(key, record);

      logger.info('Storage delinquency flagged', {
        tenantId,
        tenantHolderId,
        unitId,
        daysOverdue
      });

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'storage_delinquency',
    meterEventType: 'api_call'
  });
}

export async function fileLien(
  tenantId: string,
  actorId: string,
  delinquencyId: string,
  lienDate: string
): Promise<DelinquencyRecord> {
  return runCrudOperation({
    configName: 'delinquency-lien-auction-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entry = Array.from(
        delinquencyStore.entries()
      ).find(
        ([, record]) =>
          record.tenant_id === tenantId &&
          record.delinquency_id === delinquencyId
      );

      if (!entry) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Delinquency record not found'
        );
      }

      const [key, existing] = entry;

      if (existing.status === 'resolved') {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Resolved delinquency cannot receive a lien'
        );
      }

      const updated: DelinquencyRecord = {
        ...existing,
        lien_filed_date: lienDate,
        status: 'lien_filed',
        updated_at: new Date().toISOString()
      };

      delinquencyStore.set(key, updated);

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'storage_delinquency',
    meterEventType: 'api_call'
  });
}

export async function scheduleAuction(
  tenantId: string,
  actorId: string,
  delinquencyId: string,
  date: string
): Promise<DelinquencyRecord> {
  return runCrudOperation({
    configName: 'delinquency-lien-auction-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entry = Array.from(
        delinquencyStore.entries()
      ).find(
        ([, record]) =>
          record.tenant_id === tenantId &&
          record.delinquency_id === delinquencyId
      );

      if (!entry) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Delinquency record not found'
        );
      }

      const [key, existing] = entry;

      if (existing.status !== 'lien_filed') {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'A lien must be filed before an auction is scheduled'
        );
      }

      const updated: DelinquencyRecord = {
        ...existing,
        auction_scheduled_date: date,
        status: 'auction_scheduled',
        updated_at: new Date().toISOString()
      };

      delinquencyStore.set(key, updated);

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'storage_delinquency',
    meterEventType: 'api_call'
  });
}

export function getDelinquency(
  tenantId: string,
  tenantHolderId: string,
  unitId: string
): DelinquencyRecord | undefined {
  return delinquencyStore.get(
    getKey(tenantId, tenantHolderId, unitId)
  );
}
