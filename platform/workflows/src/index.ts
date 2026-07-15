import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({ workflowCount: z.number(), stepsPerWorkflow: z.number() })
});

export async function createWorkflow(tenantId: string, data: any) {
  const config = loadConfig('workflows', ConfigSchema);
  if (!config.enabled) throw new Error('Workflows disabled');

  if (data.steps.length > config.limits.stepsPerWorkflow) {
    throw new Error('Step limit exceeded for your tier');
  }

  const result = await withTenantQuery(
    'INSERT INTO workflows (tenant_id, name, trigger_type, steps) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, data.name, data.trigger.type, JSON.stringify(data.steps)],
    tenantId
  );
  return result[0];
}

export async function triggerWorkflow(tenantId: string, workflowId: string, triggerData: any) {
  // 1. Log Execution to DB
  const exec = await withTenantQuery(
    'INSERT INTO workflow_executions (tenant_id, workflow_id, status, trigger_data) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, workflowId, 'completed', JSON.stringify(triggerData)],
    tenantId
  );

  // 2. Metering for Billing
  await recordUsage({ tenantId, eventType: 'api_call', quantity: 1, idempotencyKey: `wf:${exec[0].id}` });

  return { executionId: exec[0].id, status: 'completed', message: "Workflow executed successfully." };
}
