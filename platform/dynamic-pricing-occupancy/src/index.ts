import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('dynamic-pricing-occupancy');

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  occupancy_thresholds: z.array(
    z.object({
      minimum_percent: z.number().min(0).max(100),
      multiplier: z.number().positive()
    })
  ).default([
    { minimum_percent: 0, multiplier: 1 },
    { minimum_percent: 70, multiplier: 1.1 },
    { minimum_percent: 85, multiplier: 1.2 },
    { minimum_percent: 95, multiplier: 1.3 }
  ])
});

export interface PricingRecord {
  pricing_id: string;
  tenant_id: string;
  facility_id: string;
  unit_size: string;
  base_rate: number;
  current_occupancy_percent: number;
  dynamic_rate: number;
  manual_override: boolean;
  created_at: string;
  updated_at: string;
}

const pricingStore = new Map<string, PricingRecord>();

export function __resetDynamicPricingOccupancyStore(): void {
  pricingStore.clear();
}

function getConfig() {
  return loadConfig(
    'dynamic-pricing-occupancy',
    ConfigSchema
  );
}

function makeKey(
  tenantId: string,
  facilityId: string,
  unitSize: string
): string {
  return `${tenantId}:${facilityId}:${unitSize}`;
}

function calculateRate(
  baseRate: number,
  occupancyPercent: number,
  thresholds: Array<{
    minimum_percent: number;
    multiplier: number;
  }>
): number {
  const applicable = [...thresholds]
    .sort((a, b) => a.minimum_percent - b.minimum_percent)
    .filter(
      (threshold) =>
        occupancyPercent >= threshold.minimum_percent
    )
    .at(-1);

  const multiplier = applicable?.multiplier ?? 1;

  return Math.round(baseRate * multiplier * 100) / 100;
}

export async function calculateDynamicRate(
  tenantId: string,
  actorId: string,
  facilityId: string,
  unitSize: string,
  baseRate: number,
  currentOccupancyPercent: number
): Promise<PricingRecord> {
  return runCrudOperation({
    configName: 'dynamic-pricing-occupancy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Dynamic pricing is disabled'
        );
      }

      if (baseRate < 0) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Base rate cannot be negative'
        );
      }

      if (
        currentOccupancyPercent < 0 ||
        currentOccupancyPercent > 100
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Occupancy must be between 0 and 100 percent'
        );
      }

      const key = makeKey(
        tenantId,
        facilityId,
        unitSize
      );

      const existing = pricingStore.get(key);
      const now = new Date().toISOString();

      if (existing?.manual_override) {
        return existing;
      }

      const dynamicRate = calculateRate(
        baseRate,
        currentOccupancyPercent,
        config.occupancy_thresholds
      );

      const record: PricingRecord = {
        pricing_id:
          existing?.pricing_id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        facility_id: facilityId,
        unit_size: unitSize,
        base_rate: baseRate,
        current_occupancy_percent: currentOccupancyPercent,
        dynamic_rate: dynamicRate,
        manual_override: false,
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      pricingStore.set(key, record);

      logger.info('Dynamic rental rate calculated', {
        tenantId,
        facilityId,
        unitSize,
        occupancyPercent: currentOccupancyPercent
      });

      return record;
    },
    auditAction: 'data.updated',
    auditResource: 'dynamic_pricing',
    meterEventType: 'api_call'
  });
}

export async function applyManualOverride(
  tenantId: string,
  actorId: string,
  facilityId: string,
  unitSize: string,
  rate: number
): Promise<PricingRecord> {
  return runCrudOperation({
    configName: 'dynamic-pricing-occupancy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (rate < 0) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Override rate cannot be negative'
        );
      }

      const key = makeKey(
        tenantId,
        facilityId,
        unitSize
      );

      const existing = pricingStore.get(key);
      const now = new Date().toISOString();

      const record: PricingRecord = {
        pricing_id:
          existing?.pricing_id ?? crypto.randomUUID(),
        tenant_id: tenantId,
        facility_id: facilityId,
        unit_size: unitSize,
        base_rate: existing?.base_rate ?? rate,
        current_occupancy_percent:
          existing?.current_occupancy_percent ?? 0,
        dynamic_rate: rate,
        manual_override: true,
        created_at: existing?.created_at ?? now,
        updated_at: now
      };

      pricingStore.set(key, record);

      return record;
    },
    auditAction: 'data.updated',
    auditResource: 'dynamic_pricing',
    meterEventType: 'api_call'
  });
}

export function getOccupancyReport(
  tenantId: string,
  facilityId: string
): PricingRecord[] {
  return Array.from(pricingStore.values()).filter(
    (record) =>
      record.tenant_id === tenantId &&
      record.facility_id === facilityId
  );
}
