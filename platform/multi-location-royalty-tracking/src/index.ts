import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('multi-location-royalty-tracking');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'overdue';

export interface RoyaltyRecord {
  royalty_id: string;
  tenant_id: string;
  franchisee_location_id: string;
  reporting_period: string;
  gross_revenue_reported: number;
  royalty_percentage: number;
  royalty_amount_due: number;
  payment_status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

const royaltyStore = new Map<string, RoyaltyRecord>();

export function __resetMultiLocationRoyaltyTrackingStore(): void {
  royaltyStore.clear();
}

function getConfig() {
  return loadConfig(
    'multi-location-royalty-tracking',
    ConfigSchema
  );
}

function getKey(
  tenantId: string,
  locationId: string,
  reportingPeriod: string
): string {
  return `${tenantId}:${locationId}:${reportingPeriod}`;
}

export async function calculateRoyalty(
  tenantId: string,
  actorId: string,
  locationId: string,
  reportingPeriod: string,
  grossRevenue: number,
  royaltyPercentage: number
): Promise<RoyaltyRecord> {
  return runCrudOperation({
    configName: 'multi-location-royalty-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Royalty tracking is disabled'
        );
      }

      if (grossRevenue < 0) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Gross revenue cannot be negative'
        );
      }

      if (
        royaltyPercentage < 0 ||
        royaltyPercentage > 100
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Royalty percentage must be between 0 and 100'
        );
      }

      if (!reportingPeriod.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Reporting period is required'
        );
      }

      const key = getKey(
        tenantId,
        locationId,
        reportingPeriod
      );

      const existing = royaltyStore.get(key);
      const now = new Date().toISOString();

      const royaltyAmount =
        Math.round(
          grossRevenue *
            (royaltyPercentage / 100) *
            100
        ) / 100;

      const record: RoyaltyRecord = {
        royalty_id:
          existing?.royalty_id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        franchisee_location_id: locationId,
        reporting_period: reportingPeriod,
        gross_revenue_reported: grossRevenue,
        royalty_percentage: royaltyPercentage,
        royalty_amount_due: royaltyAmount,
        payment_status:
          existing?.payment_status === 'paid'
            ? 'paid'
            : 'pending',
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      royaltyStore.set(key, record);

      logger.info('Franchise royalty calculated', {
        tenantId,
        locationId,
        reportingPeriod,
        royaltyAmount
      });

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'franchise_royalty',
    meterEventType: 'api_call'
  });
}

export async function recordPayment(
  tenantId: string,
  actorId: string,
  royaltyId: string
): Promise<RoyaltyRecord> {
  return runCrudOperation({
    configName: 'multi-location-royalty-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entry = Array.from(
        royaltyStore.entries()
      ).find(
        ([, record]) =>
          record.tenant_id === tenantId &&
          record.royalty_id === royaltyId
      );

      if (!entry) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Royalty record not found'
        );
      }

      const [key, existing] = entry;

      const updated: RoyaltyRecord = {
        ...existing,
        payment_status: 'paid',
        updated_at: new Date().toISOString()
      };

      royaltyStore.set(key, updated);

      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'franchise_royalty',
    meterEventType: 'api_call'
  });
}

export async function flagOverdueRoyalties(
  tenantId: string,
  actorId: string,
  daysOverdue: number
): Promise<RoyaltyRecord[]> {
  return runCrudOperation({
    configName: 'multi-location-royalty-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!Number.isInteger(daysOverdue) || daysOverdue < 1) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Days overdue must be a positive integer'
        );
      }

      const records = Array.from(
        royaltyStore.entries()
      ).filter(
        ([, record]) =>
          record.tenant_id === tenantId &&
          record.payment_status === 'pending'
      );

      const updatedRecords = records.map(
        ([key, record]) => {
          const updated: RoyaltyRecord = {
            ...record,
            payment_status: 'overdue',
            updated_at: new Date().toISOString()
          };

          royaltyStore.set(key, updated);

          return updated;
        }
      );

      return updatedRecords;
    },
    auditAction: 'data.updated',
    auditResource: 'franchise_royalty',
    meterEventType: 'api_call'
  });
}

export function getRoyalty(
  tenantId: string,
  locationId: string,
  reportingPeriod: string
): RoyaltyRecord | undefined {
  return royaltyStore.get(
    getKey(
      tenantId,
      locationId,
      reportingPeriod
    )
  );
}
