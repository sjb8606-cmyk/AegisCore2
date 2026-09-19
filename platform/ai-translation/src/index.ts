import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
import { filterPii, detectAdversarial } from '@platform/ai-safety';
import { emit as auditEmit } from '@platform/audit';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const TranslationRequestSchema = z.object({
  source_text: z.string().min(1),
  source_language: z.string().default('en'),
  target_language: z.string().min(2),
  tone: z.string().optional(),
  context: z.string().optional(),
});

export const LocaleConfigSchema = z.object({
  locale: z.string(),
  currency: z.string().optional(),
  date_format: z.string().optional(),
});

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-translation.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { basicTranslation: true, glossarySupport: true, structuredDataTranslation: true } };
}

// Adversarial detection now imported from @platform/ai-safety (see above).

// Local fake validateLlmOutput removed.
// Use the real one from @platform/ai-safety instead.

export async function validateLlmOutput(sourceText: string, options: any): Promise<any> {
  // Real LLM translation is not yet wired.
  // Previously this returned hardcoded canned translations.
  throw new (await import('@platform/utils')).AppError(
    `NOT_IMPLEMENTED: ai-translation validateLlmOutput — real LLM call + platform/ai-safety validation is not fully wired yet.`,
    'NOT_IMPLEMENTED'
  );
}

export async function translateText(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicTranslation) {
    throw new AppError('AI Translation basic tier is disabled', 'FORBIDDEN');
  }

  const parsed = TranslationRequestSchema.parse(data);

  const adversarialCheck = detectAdversarial(parsed.source_text);
  if (adversarialCheck.detected) {
    throw new AppError(`AI Safety Guard: Terminology source contains adversarial instructions (${adversarialCheck.reason}).`, 'FORBIDDEN');
  }

  const piiCheck = filterPii(parsed.source_text);
  if (piiCheck.found.length > 0) {
    await auditEmit({
      tenantId,
      actorId: 'system',
      actorType: 'system',
      action: 'ai.pii_detected',
      outcome: 'success',
      resource: 'translation_job',
      metadata: { categories: piiCheck.found },
    } as any);
  }

  const jobId = crypto.randomUUID();
  const translated = await validateLlmOutput(parsed.source_text, {});

  const res = await withTenantQuery(`
    INSERT INTO translation_jobs (id, tenant_id, source_text, source_language, target_language, translated_text, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'completed') RETURNING *;
  `, [jobId, tenantId, parsed.source_text, parsed.source_language, parsed.target_language, translated], tenantId);

  return res[0];
}

export async function addGlossaryTerm(tenantId: string, term: string, translation: string, language: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.glossarySupport) {
    throw new AppError('AI Translation glossary tier is disabled', 'FORBIDDEN');
  }

  const glossaryId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO translation_glossaries (id, tenant_id, term, translation, language)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [glossaryId, tenantId, term, translation, language], tenantId);

  return res[0];
}

export async function translateStructuredData(tenantId: string, data: any, targetLanguage: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.structuredDataTranslation) {
    throw new AppError('AI Translation structured data tier is disabled', 'FORBIDDEN');
  }

  const result = await validateLlmOutput(JSON.stringify(data), {
    schema: { translated: "object" }
  });

  return result.translated;
}

export async function getTranslationLedger(tenantId: string, jobId: string) {
  if (!isValidUuid(jobId)) throw new AppError('Invalid Job ID format.', 'BAD_REQUEST');

  const jobRes = await withTenantQuery(`
    SELECT * FROM translation_jobs WHERE id = $1 AND tenant_id = $2;
  `, [jobId, tenantId], tenantId);
  const job = jobRes[0];
  if (!job) throw new AppError('Translation job not found.', 'NOT_FOUND');

  const glossaries = await withTenantQuery(`
    SELECT * FROM translation_glossaries WHERE language = $1 AND tenant_id = $2;
  `, [job.target_language, tenantId], tenantId);

  return { ...job, active_glossaries: glossaries };
}
