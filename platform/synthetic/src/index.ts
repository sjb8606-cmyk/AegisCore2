import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';

const SyntheticConfigSchema = z.object({
  enabled: z.boolean(),
  allowedTypes: z.array(z.string()),
  limits: z.object({ maxBatchSize: z.number() })
});

export async function generateMirage(tenantId: string, type: string, count: number, sandboxId?: string) {
  const config = loadConfig('synthetic-data', SyntheticConfigSchema);
  if (!config.enabled) throw new AppError('Synthetic Engine disabled', ErrorCode.FORBIDDEN);
  if (!config.allowedTypes.includes(type)) throw new AppError(`Unsupported data type: ${type}`, ErrorCode.BAD_REQUEST);

  const finalCount = Math.min(count, config.limits.maxBatchSize);
  const mirageData = [];

  // 1. Generate Fake Data Patterns
  for (let i = 0; i < finalCount; i++) {
    if (type === 'user') {
      mirageData.push({
        id: crypto.randomUUID(),
        name: `Synthetic User ${Math.floor(Math.random() * 1000)}`,
        email: `fake_user_${i}@example.internal`,
        role: 'tester'
      });
    } else if (type === 'transaction') {
      mirageData.push({
        id: crypto.randomUUID(),
        amount: (Math.random() * 1000).toFixed(2),
        currency: 'USD',
        status: 'completed'
      });
    }
  }

  // 2. Record Generation in Ledger
  await withTenantQuery(
    `INSERT INTO synthetic_data_logs (tenant_id, sandbox_id, data_type, record_count, actor_id) 
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, sandboxId || null, type, finalCount, 'founder'],
    tenantId
  );

  // 3. Meter Usage (Revenue)
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `gen-syn:${type}:${Date.now()}`
  });

  return mirageData;
}
