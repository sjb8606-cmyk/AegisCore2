import { z } from 'zod';
import { loadConfig, AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };
import { withTenantQuery, withTenantTransaction } from '@platform/tenancy';
import { recordUsage } from '@platform/metering';
import { validateLlmOutput } from '@platform/ai-safety';
import { generateText } from '@platform/ai-gateway';
import { randomUUID } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({ piiScrubbing: z.boolean(), adversarialDetection: z.boolean() }),
  models: z.object({ default: z.string() }),
  systemPrompt: z.string().optional(),
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

  const validation = await validateLlmOutput(content, z.string());
  if (!validation.valid) {
    throw new AppError('Unsafe input blocked by AI Safety Gate', ErrorCode.BAD_REQUEST);
  }

  const historyDesc = await withTenantQuery(
    'SELECT role, content FROM ai_messages WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at DESC LIMIT 10',
    [tenantId, convoId],
    tenantId
  );
  const history = [...historyDesc].reverse();

  const llmResponse = await generateText({
    provider: 'groq',
    model: config.models.default,
    messages: [
      { role: 'system', content: config.systemPrompt ?? 'You are a secure, helpful enterprise assistant.' },
      ...history.map((h: any) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content },
    ],
    temperature: 0.7,
    maxTokens: 1024,
  });

  const replyContent = llmResponse.content;

  await withTenantTransaction(async (client) => {
    await client.query(
      'INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES ($1::uuid, $2::uuid, $3, $4)',
      [tenantId, convoId, 'user', content]
    );
    await client.query(
      'INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES ($1::uuid, $2::uuid, $3, $4)',
      [tenantId, convoId, 'assistant', replyContent]
    );
  }, tenantId);

  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `ai:${convoId}:${Date.now()}`
  });

  return { role: 'assistant', content: replyContent };
}
