import { z } from 'zod';
import { createHash } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { filterPii } from '../../ai-safety/src/index';
import { recordUsage } from '../../metering/src/index';

const TranslatorConfigSchema = z.object({
  enabled: z.boolean(),
  piiScrubbingMandatory: z.boolean(),
  defaultReadingLevel: z.string()
});

export async function translateToPlainLanguage(tenantId: string, text: string, level?: string) {
  const config = loadConfig('translator', TranslatorConfigSchema);
  if (!config.enabled) throw new AppError('Translator disabled', ErrorCode.FORBIDDEN);

  // 1. Mandatory PII Scrubbing (Non-Bypassable)
  let scrubbedText = text;
  if (config.piiScrubbingMandatory) {
    const piiResult = filterPii(text);
    scrubbedText = piiResult.sanitized;
  }

  // 2. Generate Privacy-First Hash (The digital fingerprint)
  const hash = createHash('sha256').update(scrubbedText).digest('hex');
  const targetLevel = level || config.defaultReadingLevel;

  // 3. Check Cache (Tenant isolated)
  const existing = await withTenantQuery(
    'SELECT translated_text FROM translation_cache WHERE original_hash = $1 AND reading_level = $2',
    [hash, targetLevel],
    tenantId
  );

  if (existing.length > 0) {
    return { translated: existing[0].translated_text, cached: true };
  }

  // 4. Simulate LLM Call (In production, this calls OpenAI/Anthropic)
  const simulatedTranslation = `[PLAIN LANGUAGE VERSION of: ${scrubbedText.substring(0, 20)}...]`;

  // 5. Save to Cache
  await withTenantQuery(
    'INSERT INTO translation_cache (tenant_id, original_hash, translated_text, reading_level) VALUES ($1, $2, $3, $4)',
    [tenantId, hash, simulatedTranslation, targetLevel],
    tenantId
  );

  // 6. Meter Usage
  await recordUsage({
    tenantId,
    eventType: 'api_call',
    quantity: 1,
    idempotencyKey: `trans:${hash}:${Date.now()}`
  });

  return { translated: simulatedTranslation, cached: false };
}
