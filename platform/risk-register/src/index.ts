/**
 * platform/risk-register
 *
 * Structured risk scoring, an explicit Red Team adversarial pass, and
 * staged hiring plans for Business Architect. Distinct from
 * platform/risk-scoring, which scores agent action steps (cost,
 * irreversibility, novelty) — this core scores business risks
 * (market, financial, regulatory, operational, technical). Do not merge
 * the two; different inputs, different consumers.
 *
 * redTeamMode is enforced, not just configured: finalizeRiskRegister()
 * refuses to finalize a register that has never had a Red Team pass run
 * against it, so the adversarial stage can't be silently skipped to
 * produce a nicer-looking plan.
 */
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';
import { generateText } from '@platform/ai-gateway';
import { loadConfig } from '@platform/utils';

export { AppError, ErrorCode };

const RISK_CATEGORIES = ['market', 'financial', 'regulatory', 'operational', 'technical'] as const;
const LEVELS = ['low', 'med', 'high'] as const;
const CONFIDENCE_TAGS = ['known', 'evidence_supported', 'estimated', 'assumption', 'unknown'] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export type Level = (typeof LEVELS)[number];
export type ConfidenceTag = (typeof CONFIDENCE_TAGS)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  redTeamMode: z.boolean().default(true),
  limits: z
    .object({
      risksPerRegister: z.number().default(30),
      redTeamPassesPerRun: z.number().default(1),
    })
    .default({}),
});

export interface Risk {
  description: string;
  category: RiskCategory;
  probability: Level;
  impact: Level;
  mitigation: string;
  validationRequired: string;
  confidenceTag: ConfidenceTag;
}

export async function buildRiskRegister(
  tenantId: string,
  actorId: string,
  input: { ideaId: string; unverifiedClaims: string[]; financialSummary: string; businessModel: string },
) {
  return runCrudOperation({
    configName: 'risk-register',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async () => {
      // enforced per-risk below, after generation, against limits.risksPerRegister
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const config = loadConfig('risk-register', ConfigSchema);
      const registerId = randomUUID();

      const response = await generateText({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'Generate a structured business risk register. Each risk needs: description, category ' +
              `(one of ${RISK_CATEGORIES.join('|')}), probability (${LEVELS.join('|')}), impact (${LEVELS.join(
                '|',
              )}), mitigation, validationRequired, and confidenceTag (${CONFIDENCE_TAGS.join('|')}). ` +
              'Every risk must carry a confidenceTag — do not present estimates as known facts. ' +
              'Respond as a JSON array.',
          },
          {
            role: 'user',
            content: `Business model:\n${input.businessModel}\n\nFinancial summary:\n${input.financialSummary}\n\nUnresolved research assumptions:\n${input.unverifiedClaims.join('\n')}`,
          },
        ],
        maxTokens: 1200,
        temperature: 0.2,
      });

      let risks: Risk[] = [];
      try {
        risks = JSON.parse(response.content);
      } catch {
        throw new AppError('Risk generation returned malformed output.', ErrorCode.INTERNAL);
      }

      enforceQuota(risks.length, config.limits.risksPerRegister, 'Generated risk set exceeds configured limit.');

      await withTenantQuery(
        `INSERT INTO risk_registers (id, tenant_id, idea_id, status, created_at) VALUES ($1, $2, $3, $4, now())`,
        [registerId, tenantId, input.ideaId, 'draft'],
        tenantId,
      );

      for (const risk of risks) {
        const riskId = randomUUID();
        await withTenantQuery(
          `INSERT INTO risks
            (id, register_id, tenant_id, description, category, probability, impact, mitigation, validation_required, confidence_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            riskId,
            registerId,
            tenantId,
            risk.description,
            RISK_CATEGORIES.includes(risk.category) ? risk.category : 'operational',
            LEVELS.includes(risk.probability) ? risk.probability : 'med',
            LEVELS.includes(risk.impact) ? risk.impact : 'med',
            risk.mitigation,
            risk.validationRequired,
            CONFIDENCE_TAGS.includes(risk.confidenceTag) ? risk.confidenceTag : 'unknown',
          ],
          tenantId,
        );
      }

      return { registerId, risks, riskCount: risks.length };
    },
    auditAction: 'risk_register.built',
    auditResource: 'risk_register',
    meterEventType: 'ai_call',
  });
}

export async function runRedTeamPass(
  tenantId: string,
  actorId: string,
  input: { registerId: string; topRisks: Risk[]; assumptions: string[] },
) {
  return runCrudOperation({
    configName: 'risk-register',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        `SELECT COUNT(*) as count FROM red_team_passes WHERE register_id = $1 AND tenant_id = $2`,
        [input.registerId, tenantId],
        tenantId,
      );
      enforceQuota(
        countRes[0]?.count,
        config.limits.redTeamPassesPerRun,
        'Red Team pass limit reached for this register.',
      );
    },
    action: async () => {
      const { randomUUID } = await import('crypto');

      const response = await generateText({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'You are red-teaming a business plan. Assume the founder is wrong; try to prove it. ' +
              'For each assumption and top risk given, produce an attack (the strongest reason it fails) ' +
              'and a verdict: survives, weakens, or kills. Respond as JSON array of ' +
              '{challengedAssumption, attack, verdict}.',
          },
          {
            role: 'user',
            content: `Top risks:\n${JSON.stringify(input.topRisks)}\n\nAssumptions:\n${input.assumptions.join('\n')}`,
          },
        ],
        maxTokens: 1000,
        temperature: 0.4,
      });

      let passes: { challengedAssumption: string; attack: string; verdict: 'survives' | 'weakens' | 'kills' }[] = [];
      try {
        passes = JSON.parse(response.content);
      } catch {
        throw new AppError('Red Team pass returned malformed output.', ErrorCode.INTERNAL);
      }

      for (const p of passes) {
        await withTenantQuery(
          `INSERT INTO red_team_passes (id, register_id, tenant_id, challenged_assumption, attack, verdict, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())`,
          [randomUUID(), input.registerId, tenantId, p.challengedAssumption, p.attack, p.verdict],
          tenantId,
        );
      }

      return { registerId: input.registerId, passes };
    },
    auditAction: 'risk_register.red_team.executed',
    auditResource: 'risk_register',
    auditResourceId: input.registerId,
    meterEventType: 'ai_call',
  });
}

/**
 * Refuses to finalize if redTeamMode is on and no Red Team pass has ever
 * been run against this register. This is the enforcement point — the
 * config toggle alone is not enough, because a toggle can be silently
 * flipped; a hard check at finalization can't be skipped by accident.
 */
export async function finalizeRiskRegister(tenantId: string, actorId: string, input: { registerId: string }) {
  return runCrudOperation({
    configName: 'risk-register',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      if (!config.redTeamMode) return;
      const countRes = await withTenantQuery(
        `SELECT COUNT(*) as count FROM red_team_passes WHERE register_id = $1 AND tenant_id = $2`,
        [input.registerId, tenantId],
        tenantId,
      );
      if (Number(countRes[0]?.count ?? 0) === 0) {
        throw new AppError(
          'Cannot finalize a risk register without at least one Red Team pass while redTeamMode is enabled.',
          ErrorCode.FORBIDDEN,
        );
      }
    },
    action: async () => {
      await withTenantQuery(
        `UPDATE risk_registers SET status = 'finalized' WHERE id = $1 AND tenant_id = $2`,
        [input.registerId, tenantId],
        tenantId,
      );
      return { registerId: input.registerId, status: 'finalized' };
    },
    auditAction: 'risk_register.finalized',
    auditResource: 'risk_register',
    auditResourceId: input.registerId,
  });
}

export async function buildHiringPlan(
  tenantId: string,
  actorId: string,
  input: { ideaId: string; breakEvenMonth: number | null; businessModel: string },
) {
  return runCrudOperation({
    configName: 'risk-register',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { randomUUID } = await import('crypto');

      const response = await generateText({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'Given a business model and break-even month, propose a staged hiring plan. ' +
              'Respond as JSON array of {stageNumber, roleTitle, skillsRequired, triggerCondition, approxHeadcount}.',
          },
          {
            role: 'user',
            content: `Business model:\n${input.businessModel}\n\nBreak-even month: ${input.breakEvenMonth ?? 'not reached in projection'}`,
          },
        ],
        maxTokens: 700,
        temperature: 0.3,
      });

      let stages: {
        stageNumber: number;
        roleTitle: string;
        skillsRequired: string;
        triggerCondition: string;
        approxHeadcount: number;
      }[] = [];
      try {
        stages = JSON.parse(response.content);
      } catch {
        throw new AppError('Hiring plan generation returned malformed output.', ErrorCode.INTERNAL);
      }

      for (const s of stages) {
        await withTenantQuery(
          `INSERT INTO hiring_stages
            (id, tenant_id, idea_id, stage_number, role_title, skills_required, trigger_condition, approx_headcount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), tenantId, input.ideaId, s.stageNumber, s.roleTitle, s.skillsRequired, s.triggerCondition, s.approxHeadcount],
          tenantId,
        );
      }

      return { ideaId: input.ideaId, stages };
    },
    auditAction: 'hiring_plan.built',
    auditResource: 'hiring_plan',
    meterEventType: 'ai_call',
  });
}
