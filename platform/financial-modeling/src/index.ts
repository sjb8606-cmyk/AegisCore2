/**
 * platform/financial-modeling
 *
 * Startup-specific financial math: capital requirements, break-even,
 * scenario/sensitivity analysis. The core calculation is deterministic
 * arithmetic and deliberately does NOT route through @platform/ai-gateway —
 * numbers come from math, not from a model. Only the plain-language
 * explanation of the numbers calls the LLM, and it never touches the raw
 * figures — it narrates numbers computed elsewhere.
 */
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';
import { generateText } from '@platform/ai-gateway';
import { loadConfig } from '@platform/utils';

export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      modelsPerMonth: z.number().default(20),
      scenariosPerModel: z.number().default(5),
    })
    .default({}),
  defaults: z
    .object({
      currency: z.string().default('CAD'),
      discountRate: z.number().default(0.08),
    })
    .default({}),
});

export interface StartupCosts {
  [lineItem: string]: number;
}
export interface OperatingCosts {
  [lineItem: string]: number; // monthly
}
export interface RevenueAssumptions {
  monthlyRevenueRampCad: number[]; // projected monthly revenue, month 1..N
}

export interface FinancialModelResult {
  modelId: string;
  currency: string;
  totalStartupCosts: number;
  monthlyOperatingCosts: number;
  breakEvenMonth: number | null;
  breakEvenRevenue: number | null;
  twelveMonthNet: number;
}

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

/** Pure calculation — no LLM, no network. Deterministic on purpose. */
function computeModel(
  startupCosts: StartupCosts,
  operatingCosts: OperatingCosts,
  revenue: RevenueAssumptions,
): Omit<FinancialModelResult, 'modelId' | 'currency'> {
  const totalStartupCosts = sumValues(startupCosts);
  const monthlyOperatingCosts = sumValues(operatingCosts);

  let cumulative = -totalStartupCosts;
  let breakEvenMonth: number | null = null;
  let breakEvenRevenue: number | null = null;

  const months = revenue.monthlyRevenueRampCad;
  for (let i = 0; i < months.length; i++) {
    cumulative += months[i] - monthlyOperatingCosts;
    if (breakEvenMonth === null && cumulative >= 0) {
      breakEvenMonth = i + 1;
      breakEvenRevenue = months[i];
    }
  }

  const twelveMonthNet =
    months.slice(0, 12).reduce((a, b) => a + b, 0) - monthlyOperatingCosts * Math.min(12, months.length) - totalStartupCosts;

  return { totalStartupCosts, monthlyOperatingCosts, breakEvenMonth, breakEvenRevenue, twelveMonthNet };
}

export async function createFinancialModel(
  tenantId: string,
  actorId: string,
  input: {
    ideaId: string;
    startupCosts: StartupCosts;
    operatingCosts: OperatingCosts;
    revenueAssumptions: RevenueAssumptions;
  },
) {
  return runCrudOperation({
    configName: 'financial-modeling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        `SELECT COUNT(*) as count FROM financial_models
         WHERE tenant_id = $1 AND created_at > now() - interval '30 days'`,
        [tenantId],
        tenantId,
      );
      enforceQuota(
        countRes[0]?.count,
        config.limits.modelsPerMonth,
        'Monthly financial model limit reached for this tenant.',
      );
    },
    action: async (): Promise<FinancialModelResult> => {
      const { randomUUID } = await import('crypto');
      const modelId = randomUUID();
      const config = loadConfig('financial-modeling', ConfigSchema);
      const computed = computeModel(input.startupCosts, input.operatingCosts, input.revenueAssumptions);

      await withTenantQuery(
        `INSERT INTO financial_models
          (id, tenant_id, idea_id, currency, startup_costs, operating_costs, revenue_assumptions,
           break_even_month, break_even_revenue, twelve_month_net, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          modelId,
          tenantId,
          input.ideaId,
          config.defaults.currency,
          JSON.stringify(input.startupCosts),
          JSON.stringify(input.operatingCosts),
          JSON.stringify(input.revenueAssumptions),
          computed.breakEvenMonth,
          computed.breakEvenRevenue,
          computed.twelveMonthNet,
        ],
        tenantId,
      );

      return { modelId, currency: config.defaults.currency, ...computed };
    },
    auditAction: 'financial_model.created',
    auditResource: 'financial_model',
    meterEventType: 'api_call',
  });
}

export interface ScenarioOverride {
  name: string;
  revenueMultiplier: number; // e.g. 0.5 for -50% revenue
  costMultiplier: number; // e.g. 1.3 for +30% costs
}

const DEFAULT_SCENARIOS: ScenarioOverride[] = [
  { name: 'base', revenueMultiplier: 1, costMultiplier: 1 },
  { name: 'revenue_down_50', revenueMultiplier: 0.5, costMultiplier: 1 },
  { name: 'costs_up_30', revenueMultiplier: 1, costMultiplier: 1.3 },
  { name: 'worst_case', revenueMultiplier: 0.5, costMultiplier: 1.3 },
];

export async function runSensitivity(
  tenantId: string,
  actorId: string,
  input: {
    modelId: string;
    startupCosts: StartupCosts;
    operatingCosts: OperatingCosts;
    revenueAssumptions: RevenueAssumptions;
    scenarios?: ScenarioOverride[];
  },
) {
  return runCrudOperation({
    configName: 'financial-modeling',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const scenarios = input.scenarios ?? DEFAULT_SCENARIOS;
      if (scenarios.length > config.limits.scenariosPerModel) {
        throw new AppError(
          `Requested ${scenarios.length} scenarios, limit is ${config.limits.scenariosPerModel}.`,
          ErrorCode.BAD_REQUEST,
        );
      }
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const scenarios = input.scenarios ?? DEFAULT_SCENARIOS;
      const results = [];

      for (const scenario of scenarios) {
        const adjustedCosts: OperatingCosts = Object.fromEntries(
          Object.entries(input.operatingCosts).map(([k, v]) => [k, v * scenario.costMultiplier]),
        );
        const adjustedRevenue: RevenueAssumptions = {
          monthlyRevenueRampCad: input.revenueAssumptions.monthlyRevenueRampCad.map(
            (v) => v * scenario.revenueMultiplier,
          ),
        };
        const computed = computeModel(input.startupCosts, adjustedCosts, adjustedRevenue);
        const scenarioId = randomUUID();

        await withTenantQuery(
          `INSERT INTO financial_scenarios
            (id, model_id, tenant_id, name, variable_overrides, break_even_month, break_even_revenue, twelve_month_net)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            scenarioId,
            input.modelId,
            tenantId,
            scenario.name,
            JSON.stringify(scenario),
            computed.breakEvenMonth,
            computed.breakEvenRevenue,
            computed.twelveMonthNet,
          ],
          tenantId,
        );

        results.push({ scenarioId, name: scenario.name, ...computed });
      }

      return results;
    },
    auditAction: 'financial_model.sensitivity.run',
    auditResource: 'financial_model',
    auditResourceId: input.modelId,
  });
}

/**
 * The one function in this core allowed to call the LLM — takes numbers
 * that have already been computed deterministically and narrates them.
 * Never pass raw cost/revenue inputs here for the model to "generate";
 * only pass already-computed results.
 */
export async function explainVariance(
  tenantId: string,
  actorId: string,
  input: { modelId: string; baseResult: FinancialModelResult; scenarioResults: any[] },
) {
  const response = await generateText({
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You narrate already-computed financial scenario results in plain language for a founder. ' +
          'Do not invent or alter any numbers — only explain what the given numbers mean.',
      },
      {
        role: 'user',
        content: `Base case: ${JSON.stringify(input.baseResult)}\n\nScenarios: ${JSON.stringify(
          input.scenarioResults,
        )}`,
      },
    ],
    maxTokens: 500,
    temperature: 0.3,
  });

  return { modelId: input.modelId, narrative: response.content };
}
