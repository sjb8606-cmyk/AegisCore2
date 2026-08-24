import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const RecommendationSchema = z.object({
  recommendationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  diagnosisId: z.string().uuid(),
  repairCostEstimate: z.number().nonnegative(),
  applianceAgeYears: z.number().nonnegative(),
  replacementCostEstimate: z.number().positive(),
  recommendation: z.enum(['repair', 'replace', 'client_choice']),
  clientDecision: z.enum(['repair', 'replace']).nullable(),
  createdAt: z.string().datetime()
});

export type RepairVsReplaceRecommendation =
  z.infer<typeof RecommendationSchema>;

const recommendationStore =
  new Map<string, RepairVsReplaceRecommendation>();

export function __resetRepairVsReplaceRecommendationStore(): void {
  recommendationStore.clear();
}

export async function generateRecommendation(
  tenantId: string,
  actorId: string,
  diagnosisId: string,
  repairCost: number,
  applianceAge: number,
  replacementCost: number
): Promise<RepairVsReplaceRecommendation> {
  return runCrudOperation({
    configName: 'repair-vs-replace-recommendation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (repairCost < 0 || !Number.isFinite(repairCost)) {
        throw new AppError(
          'Repair cost must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (applianceAge < 0 || !Number.isFinite(applianceAge)) {
        throw new AppError(
          'Appliance age must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      if (replacementCost <= 0 || !Number.isFinite(replacementCost)) {
        throw new AppError(
          'Replacement cost must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      const repairRatio = repairCost / replacementCost;

      const recommendation =
        applianceAge >= 15 || repairRatio >= 0.75
          ? 'replace'
          : repairRatio <= 0.4 && applianceAge < 10
            ? 'repair'
            : 'client_choice';

      const record = RecommendationSchema.parse({
        recommendationId: crypto.randomUUID(),
        tenantId,
        diagnosisId,
        repairCostEstimate: repairCost,
        applianceAgeYears: applianceAge,
        replacementCostEstimate: replacementCost,
        recommendation,
        clientDecision: null,
        createdAt: new Date().toISOString()
      });

      recommendationStore.set(record.recommendationId, record);
      return record;
    },
    auditAction: 'data.created',
    auditResource: 'repair_vs_replace_recommendation',
    meterEventType: 'api_call'
  });
}

export async function recordClientDecision(
  tenantId: string,
  actorId: string,
  recommendationId: string,
  decision: 'repair' | 'replace'
): Promise<RepairVsReplaceRecommendation> {
  return runCrudOperation({
    configName: 'repair-vs-replace-recommendation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const record = recommendationStore.get(recommendationId);

      if (!record) {
        throw new AppError(
          'Recommendation not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (record.tenantId !== tenantId) {
        throw new AppError(
          'Recommendation does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      const updated = RecommendationSchema.parse({
        ...record,
        clientDecision: decision
      });

      recommendationStore.set(recommendationId, updated);
      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'repair_vs_replace_recommendation',
    meterEventType: 'api_call'
  });
}
