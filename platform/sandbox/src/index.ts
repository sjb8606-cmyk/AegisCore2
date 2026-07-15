import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';
import { randomUUID } from 'crypto';

const SandboxConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    sessionTtlMinutes: z.number(),
    tokenBudgetPerSession: z.number()
  })
});

export async function createSandboxSession(tenantId: string, actorId: string) {
  const config = loadConfig('sandbox', SandboxConfigSchema);
  if (!config.enabled) throw new AppError('Sandbox disabled', ErrorCode.FORBIDDEN);

  // 1. Generate the "Parallel Universe" ID
  const sandboxTenantId = randomUUID();
  const expiresAt = new Date(Date.now() + config.limits.sessionTtlMinutes * 60000);

  // 2. Record the Session
  const rows = await withTenantQuery(
    `INSERT INTO sandbox_sessions (tenant_id, actor_id, sandbox_tenant_id, token_budget, expires_at) 
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, actorId, sandboxTenantId, config.limits.tokenBudgetPerSession, expiresAt],
    tenantId
  );

  // 3. Audit the creation
  await auditEmit({
    tenantId,
    action: 'tenant.created',
    outcome: 'success',
    actorId,
    actorType: 'user',
    resource: 'sandbox_session',
    metadata: { sandboxTenantId }
  });

  return rows[0];
}

export async function captureRequest(sessionId: string, tenantId: string, data: any) {
  return await withTenantQuery(
    `INSERT INTO sandbox_requests (session_id, tenant_id, method, path, request_body, response_body) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [sessionId, tenantId, data.method, data.path, JSON.stringify(data.request), JSON.stringify(data.response)],
    tenantId
  );
}
