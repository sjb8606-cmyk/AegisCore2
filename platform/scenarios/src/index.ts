import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const ScenarioConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ maxStepsPerScenario: z.number() })
});

export async function runScenario(tenantId: string, name: string, steps: any[]) {
  const config = loadConfig('scenarios', ScenarioConfigSchema);
  if (!config.enabled) throw new AppError('Scenario Runner disabled', ErrorCode.FORBIDDEN);

  console.log(`🎬 Running Scenario: ${name}`);
  let stepsExecuted = 0;
  let status = 'passed';
  let errorLog = null;

  try {
    for (const step of steps) {
      if (stepsExecuted >= config.limits.maxStepsPerScenario) break;
      // Simulate execution of a step
      console.log(`  Step ${stepsExecuted + 1}: ${step.action} - OK`);
      stepsExecuted++;
    }
  } catch (err: any) {
    status = 'failed';
    errorLog = err.message;
  }

  // Record Result
  await withTenantQuery(
    `INSERT INTO scenario_results (tenant_id, scenario_name, status, steps_executed, error_log) 
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, name, status, stepsExecuted, errorLog],
    tenantId
  );

  return { status, stepsExecuted, errorLog };
}
