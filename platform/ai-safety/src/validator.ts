import { z, ZodSchema } from 'zod';
import { getLogger, aiSafetyViolations, aiResponseValidations } from '@platform/observability';
import { loadConfig } from '@platform/utils';
import { filterPii } from './pii-filter';
import { detectAdversarial } from './adversarial';

const logger = getLogger('ai-safety:validator');

const AiConfigSchema = z.object({
  maxResponseTokens: z.number(),
  blockMedicalIntent: z.boolean(),
  piiFilterEnabled: z.boolean(),
  adversarialEnabled: z.boolean()
});

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  violations: any[];
  filtered: boolean;
}

export async function validateLlmOutput<T>(
  raw: string, schema: ZodSchema<T>, context?: any
): Promise<ValidationResult<T>> {
  // 1. DYNAMIC LOAD: Read the AI Rules from JSON
  const config = loadConfig('ai-safety', AiConfigSchema);
  const violations: any[] = [];

  if (!raw || raw.trim().length === 0) {
    violations.push({ type: 'empty_response', severity: 'medium' });
    return { valid: false, violations, filtered: false };
  }

  // 2. Token Limit Check
  if (Math.ceil(raw.length / 4) > config.maxResponseTokens) {
    violations.push({ type: 'content_too_long', severity: 'medium' });
  }

  // 3. Hacker / Jailbreak Check
  if (config.adversarialEnabled) {
    const adv = detectAdversarial(raw);
    if (adv.detected) {
      logger.warn('🚨 Hacker Jailbreak Attempt Blocked!');
      violations.push({ type: 'adversarial_prompt', severity: 'critical' });
      return { valid: false, violations, filtered: false };
    }
  }

  // 4. Medical / Legal Liability Guard
  if (config.blockMedicalIntent && /\b(diagnose|prescribe|treatment)\b/i.test(raw)) {
    violations.push({ type: 'medical_intent', severity: 'high' });
  }

  // 5. PII (Social Security / Credit Card) Filter
  let filtered = false;
  let sanitized = raw;
  if (config.piiFilterEnabled) {
    const pii = filterPii(raw);
    if (pii.found.length > 0) {
      violations.push({ type: 'pii_detected', severity: 'high' });
      filtered = true;
      sanitized = pii.sanitized;
    }
  }

  let parsed: any = sanitized;
  try { parsed = JSON.parse(sanitized); } catch (e) {}

  if (schema) {
    const parseResult = schema.safeParse(parsed);
    if (!parseResult.success) {
      violations.push({ type: 'schema_invalid', severity: 'high' });
    } else {
      parsed = parseResult.data;
    }
  }

  const hasHighSeverity = violations.some(v => v.severity === 'high' || v.severity === 'critical');
  return { valid: !hasHighSeverity, data: parsed, violations, filtered };
}
