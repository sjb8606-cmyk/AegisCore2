import { z } from 'zod';
import { createHash } from 'crypto';
import { loadConfig, AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
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

  let scrubbedText = text;
  if (config.piiScrubbingMandatory) {
    const piiResult = filterPii(text);
    scrubbedText = piiResult.sanitized;
  }

  const hash = createHash('sha256').update(scrubbedText).digest('hex');
  const targetLevel = level || config.defaultReadingLevel;

  const existing = await withTenantQuery(
    'SELECT translated_text FROM translation_cache WHERE original_hash = $1 AND reading_level = $2',
    [hash, targetLevel],
    tenantId
  );

  if (existing.length > 0) {
    return { translated: existing[0].translated_text, cached: true };
  }

  // Real LLM translation is not yet implemented.
  throw new AppError(
    `NOT_IMPLEMENTED: translateToPlainLanguage — real LLM translation call is not wired yet. ` +
    `Cache miss for hash ${hash}.`,
    'NOT_IMPLEMENTED'
  );
}
