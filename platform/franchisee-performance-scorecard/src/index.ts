import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger(
  'franchisee-performance-scorecard'
);

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

export interface PerformanceScorecard {
  scorecard_id: string;
  tenant_id: string;
  location_id: string;
  reporting_period: string;
  revenue_rank: number;
  compliance_score: number;
  customer_satisfaction_score: number;
  overall_rank: number;
  created_at: string;
  updated_at: string;
}

interface ScorecardInput {
  location_id: string;
  reporting_period: string;
  revenue_rank: number;
  compliance_score: number;
  customer_satisfaction_score: number;
}

const scorecardStore =
  new Map<string, PerformanceScorecard>();

export function __resetFranchiseePerformanceScorecardStore(): void {
  scorecardStore.clear();
}

function getConfig() {
  return loadConfig(
    'franchisee-performance-scorecard',
    ConfigSchema
  );
}

function getKey(
  tenantId: string,
  locationId: string,
  period: string
): string {
  return `${tenantId}:${locationId}:${period}`;
}

function validateScore(
  value: number,
  field: string
): void {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      `${field} must be between 0 and 100`
    );
  }
}

export async function generateScorecard(
  tenantId: string,
  actorId: string,
  input: ScorecardInput
): Promise<PerformanceScorecard> {
  return runCrudOperation({
    configName: 'franchisee-performance-scorecard',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = getConfig();

      if (!config.enabled) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Franchisee performance scorecard is disabled'
        );
      }

      if (!input.location_id.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Location ID is required'
        );
      }

      if (!input.reporting_period.trim()) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Reporting period is required'
        );
      }

      if (
        !Number.isInteger(input.revenue_rank) ||
        input.revenue_rank < 1
      ) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Revenue rank must be a positive integer'
        );
      }

      validateScore(
        input.compliance_score,
        'Compliance score'
      );

      validateScore(
        input.customer_satisfaction_score,
        'Customer satisfaction score'
      );

      /*
       * The scorecard intentionally keeps the ranking model
       * simple and deterministic at the core level.
       *
       * Network-level ranking can later consume configurable
       * weighting from the platform's analytics/config system.
       */
      const overallScore =
        (input.compliance_score +
          input.customer_satisfaction_score) /
        2;

      const now = new Date().toISOString();
      const key = getKey(
        tenantId,
        input.location_id,
        input.reporting_period
      );

      const existing = scorecardStore.get(key);

      const record: PerformanceScorecard = {
        scorecard_id:
          existing?.scorecard_id ??
          crypto.randomUUID(),
        tenant_id: tenantId,
        location_id: input.location_id,
        reporting_period: input.reporting_period,
        revenue_rank: input.revenue_rank,
        compliance_score:
          input.compliance_score,
        customer_satisfaction_score:
          input.customer_satisfaction_score,
        overall_rank:
          existing?.overall_rank ?? 0,
        created_at:
          existing?.created_at ?? now,
        updated_at: now
      };

      scorecardStore.set(key, record);

      logger.info(
        'Franchisee performance scorecard generated',
        {
          tenantId,
          locationId: input.location_id,
          reportingPeriod: input.reporting_period,
          overallScore
        }
      );

      return record;
    },
    auditAction: 'data.created',
    auditResource: 'franchisee_performance_scorecard',
    meterEventType: 'api_call'
  });
}

export async function getNetworkRankings(
  tenantId: string,
  actorId: string,
  reportingPeriod: string
): Promise<PerformanceScorecard[]> {
  return runCrudOperation({
    configName: 'franchisee-performance-scorecard',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const records = Array.from(
        scorecardStore.values()
      ).filter(
        (record) =>
          record.tenant_id === tenantId &&
          record.reporting_period ===
            reportingPeriod
      );

      /*
       * Higher compliance/customer satisfaction is better.
       * Revenue rank is also incorporated so that the scorecard
       * remains useful as a network comparison surface.
       */
      const ranked = records
        .map((record) => ({
          record,
          composite:
            ((record.compliance_score +
              record.customer_satisfaction_score) /
              2) -
            record.revenue_rank
        }))
        .sort(
          (a, b) => b.composite - a.composite
        );

      return ranked.map(
        ({ record }, index) => {
          const updated: PerformanceScorecard = {
            ...record,
            overall_rank: index + 1,
            updated_at:
              new Date().toISOString()
          };

          scorecardStore.set(
            getKey(
              tenantId,
              record.location_id,
              record.reporting_period
            ),
            updated
          );

          return updated;
        }
      );
    },
    auditAction: 'data.read',
    auditResource: 'franchisee_performance_scorecard',
    meterEventType: 'api_call'
  });
}

export async function flagUnderperformingLocations(
  tenantId: string,
  actorId: string,
  threshold: number,
  reportingPeriod?: string
): Promise<PerformanceScorecard[]> {
  return runCrudOperation({
    configName: 'franchisee-performance-scorecard',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      validateScore(
        threshold,
        'Threshold'
      );

      const records = Array.from(
        scorecardStore.values()
      ).filter(
        (record) =>
          record.tenant_id === tenantId &&
          (
            !reportingPeriod ||
            record.reporting_period ===
              reportingPeriod
          )
      );

      return records.filter((record) => {
        const average =
          (record.compliance_score +
            record.customer_satisfaction_score) /
          2;

        return average < threshold;
      });
    },
    auditAction: 'data.read',
    auditResource: 'franchisee_performance_scorecard',
    meterEventType: 'api_call'
  });
}

export function getScorecard(
  tenantId: string,
  locationId: string,
  reportingPeriod: string
): PerformanceScorecard | undefined {
  const record = scorecardStore.get(
    getKey(
      tenantId,
      locationId,
      reportingPeriod
    )
  );

  if (
    !record ||
    record.tenant_id !== tenantId
  ) {
    return undefined;
  }

  return record;
}
