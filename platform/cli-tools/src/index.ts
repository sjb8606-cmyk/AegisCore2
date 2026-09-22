/**
 * @platform/cli-tools
 *
 * Register tenant CLI commands and record executions.
 * Handlers are keyed (handler_key); actual execution is delegated to
 * a caller-supplied runner so the core stays pure and testable.
 * Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const RegisterCommandSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z][a-z0-9:-]*$/),
  description: z.string().max(2000).optional().nullable(),
  handler_key: z.string().min(1).max(120),
  arg_schema: z.record(z.unknown()).optional().nullable(),
  is_dangerous: z.boolean().default(false),
});

export const ExecuteCommandSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

export type CommandRunner = (
  handlerKey: string,
  args: Record<string, unknown>,
  ctx: { tenantId: string; executedBy: string },
) => Promise<unknown>;

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'cli-tools');
  if (!cfg.enabled) {
    throw new AppError('CLI tools is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

async function requireTier(tenantId: string, feature: string) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.[feature]) {
    throw new AppError(`Feature ${feature} not available in current tier`, ErrorCode.FORBIDDEN);
  }
  return cfg;
}

export async function registerCommand(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'registerCommands');
  const parsed = RegisterCommandSchema.parse(input);

  if (parsed.is_dangerous) {
    await requireTier(tenantId, 'dangerousCommands');
  }

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM cli_commands WHERE tenant_id = $1 AND active = true`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.maxCommandsPerTenant ?? 100;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Command limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO cli_commands (
       tenant_id, name, description, handler_key, arg_schema, is_dangerous, created_by
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       description = EXCLUDED.description,
       handler_key = EXCLUDED.handler_key,
       arg_schema = EXCLUDED.arg_schema,
       is_dangerous = EXCLUDED.is_dangerous,
       active = true,
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      parsed.name,
      parsed.description ?? null,
      parsed.handler_key,
      JSON.stringify(parsed.arg_schema ?? {}),
      parsed.is_dangerous,
      createdBy,
    ],
    tenantId,
  );
  return rows[0];
}

export async function listCommands(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM cli_commands WHERE tenant_id = $1 AND active = true ORDER BY name`,
    [tenantId],
    tenantId,
  );
}

export async function executeCommand(
  tenantId: string,
  input: unknown,
  executedBy: string,
  runner: CommandRunner,
) {
  await requireTier(tenantId, 'executeCommands');
  const parsed = ExecuteCommandSchema.parse(input);

  const commands = await withTenantQuery(
    `SELECT * FROM cli_commands WHERE tenant_id = $1 AND name = $2 AND active = true`,
    [tenantId, parsed.name],
    tenantId,
  );
  if (!commands.length) {
    throw new AppError('Command not found', ErrorCode.NOT_FOUND);
  }
  const cmd = commands[0];

  if (cmd.is_dangerous) {
    await requireTier(tenantId, 'dangerousCommands');
  }

  let status: 'completed' | 'failed' = 'completed';
  let result: unknown = null;
  let errorMessage: string | null = null;

  try {
    result = await runner(cmd.handler_key, parsed.args, { tenantId, executedBy });
  } catch (err: any) {
    status = 'failed';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const rows = await withTenantQuery(
    `INSERT INTO cli_executions (
       tenant_id, command_id, command_name, args, status, result, error_message, executed_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)
     RETURNING *`,
    [
      tenantId,
      cmd.id,
      cmd.name,
      JSON.stringify(parsed.args),
      status,
      result != null ? JSON.stringify(result) : null,
      errorMessage,
      executedBy,
    ],
    tenantId,
  );

  if (status === 'failed') {
    throw new AppError(errorMessage || 'Command failed', ErrorCode.INTERNAL_ERROR ?? 'INTERNAL_ERROR');
  }

  return { execution: rows[0], result };
}

export async function listExecutions(tenantId: string, limit = 50) {
  await requireTier(tenantId, 'commandHistory');
  const safeLimit = Math.min(Math.max(1, limit), 200);
  return withTenantQuery(
    `SELECT * FROM cli_executions WHERE tenant_id = $1 ORDER BY executed_at DESC LIMIT $2`,
    [tenantId, safeLimit],
    tenantId,
  );
}
