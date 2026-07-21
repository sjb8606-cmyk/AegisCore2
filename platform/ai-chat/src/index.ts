import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { withTenantQuery, withTenantTransaction } from '../../tenancy/src/index';
import { recordUsage } from '../../metering/src/index';
import { validateLlmOutput } from '../../ai-safety/src/index';
import { randomUUID } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({ piiScrubbing: z.boolean(), adversarialDetection: z.boolean() }),
  models: z.object({ default: z.string() })
});

export async function startConversation(tenantId: string, userId: string) {
  const config = loadConfig('ai-chat', ConfigSchema);
  if (!config.enabled) throw new AppError('AI Chat disabled', ErrorCode.FORBIDDEN);

  const result = await withTenantQuery(
    'INSERT INTO ai_conversations (tenant_id, user_id, model) VALUES ($1, $2, $3) RETURNING *',
    [tenantId, userId, config.models.default],
    tenantId
  );
  return result[0];
}

export async function sendMessage(tenantId: string, convoId: string, content: string, userId: string) {
  const config = loadConfig('ai-chat', ConfigSchema);
  if (!config.enabled) throw new AppError('AI Chat disabled', ErrorCode.FORBIDDEN);

  // 1. AI Safety Input Check (PII & Adversarial)
  const validation = await validateLlmOutput(content, z.string());
  if (!validation.valid) {
    throw new AppError('Unsafe input blocked by AI Safety Gate', ErrorCode.BAD_REQUEST);
  }

  // 2. Simulate Model Output (In production, this queries Anthropic/OpenAI)
  const simulatedReply = `[Oracle AI - ${config.models.default}]: I have analyzed your request in the secure tenant bubble. Your input was safe and has been processed.`;

  // 3. Save Both Messages atomically
  await withTenantTransaction(async (client) => {
    await client.query(
      'INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES ($1::uuid, $2::uuid, $3, $4)',
      [tenantId, convoId, 'user', content]
    );
    await client.query(
      'INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES ($1::uuid, $2::uuid, $3, $4)',
      [tenantId, convoId, 'assistant', simulatedReply]
    );
  }, tenantId);

  // 4. Meter usage
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `ai:${convoId}:${Date.now()}`
  });

  return { role: 'assistant', content: simulatedReply };
}
