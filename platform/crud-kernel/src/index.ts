import { z, ZodSchema } from 'zod';
import { loadConfig, AppError, ErrorCode } from '@platform/utils';
import { emit as auditEmit } from '@platform/audit';
import { recordUsage } from '@platform/metering';

export { AppError, ErrorCode };

export interface CrudOperationOptions<T> {
  configName: string;
  configSchema: ZodSchema<any>;
  tenantId: string;
  actorId: string;
  actorType?: 'user' | 'service' | 'system';
  checkQuota?: (config: any) => Promise<void> | void;
  action: () => Promise<T>;
  auditAction: string;
  auditResource?: string;
  auditResourceId?: string;
  auditMetadata?: Record<string, unknown>;
  meterEventType?: string;
}

export async function runCrudOperation<T>(opts: CrudOperationOptions<T>): Promise<T> {
  const config = loadConfig(opts.configName, opts.configSchema);
  if (config && config.enabled === false) {
    throw new AppError(`${opts.configName} is disabled`, ErrorCode.FORBIDDEN);
  }

  if (opts.checkQuota) {
    await opts.checkQuota(config);
  }

  const result = await opts.action();

  await auditEmit({
    tenantId: opts.tenantId,
    actorId: opts.actorId,
    actorType: opts.actorType ?? 'user',
    action: opts.auditAction as any,
    outcome: 'success',
    resource: opts.auditResource,
    resourceId: opts.auditResourceId,
    metadata: opts.auditMetadata,
  } as any);

  if (opts.meterEventType) {
    const { randomUUID } = await import('crypto');
    await recordUsage({
      tenantId: opts.tenantId,
      eventType: opts.meterEventType,
      quantity: 1,
      idempotencyKey: `${opts.configName}:${randomUUID()}`,
    });
  }

  return result;
}
