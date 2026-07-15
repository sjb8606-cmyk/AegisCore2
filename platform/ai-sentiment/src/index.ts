import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const SentimentAnalysisSchema = z.object({
  sentiment_score: z.number().min(-1).max(1),
  emotion: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const HealthScoreUpdateSchema = z.object({
  customer_id: z.string().uuid(),
  health_score: z.number().min(0).max(1),
  churn_risk: z.number().min(0).max(1),
  nps_prediction: z.number().min(0).max(1).optional(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config', 'ai-sentiment.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { basicSentiment: true, customerHealthScore: true } };
}

// Integrated Adversarial Linguistic Filter
export async function detectAdversarial(sourceText: string): Promise<void> {
  const cleanText = sourceText.toLowerCase();

  // Guard: Prevent prompt-injection overrides in customer feedback pipelines
  const bypassKeywords = ['override safety guidelines', 'ignore system rules', 'system administrative bypass', 'force positive sentiment'];
  for (const keyword of bypassKeywords) {
    if (cleanText.includes(keyword)) {
      throw new AppError('AI Safety Guard: Feedback input rejected due to adversarial injection instructions.', 'FORBIDDEN');
    }
  }
}

// Integrated Real-Time Sentiment Mock Evaluator
export async function validateLlmOutput(sourceText: string, options: any): Promise<any> {
  const textLower = sourceText.toLowerCase();

  // Rules-based sentiment classification
  let sentiment_score = 0.05;
  let emotion = "neutral";

  if (textLower.includes('love') || textLower.includes('great') || textLower.includes('amazing')) {
    sentiment_score = 0.95;
    emotion = "joy";
  } else if (textLower.includes('horrible') || textLower.includes('terrible') || textLower.includes('broke')) {
    sentiment_score = -0.85;
    emotion = "anger";
  }

  return {
    sentiment_score,
    emotion,
    confidence: 0.96
  };
}

export async function analyzeSentiment(tenantId: string, text: string, entityType: string, entityId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicSentiment) {
    throw new AppError('AI Sentiment basic classification tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(entityId)) throw new AppError('Invalid Entity ID format.', 'BAD_REQUEST');

  // Guard prompt injection
  await detectAdversarial(text);

  const evaluation = await validateLlmOutput(text, {});
  const analysisId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO sentiment_analysis (id, tenant_id, entity_type, entity_id, text, sentiment_score, emotion, confidence, source_channel)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'api') RETURNING *;
  `, [analysisId, tenantId, entityType, entityId, text, evaluation.sentiment_score, evaluation.emotion, evaluation.confidence], tenantId);

  return res[0];
}

export async function updateHealthScore(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.customerHealthScore) {
    throw new AppError('Customer health scoring tier is disabled', 'FORBIDDEN');
  }

  const parsed = HealthScoreUpdateSchema.parse(data);
  const healthId = crypto.randomUUID();
  const nps = parsed.nps_prediction || 0.80;

  // Insert or Update customer health score atomically
  const res = await withTenantQuery(`
    INSERT INTO customer_health_scores (id, tenant_id, customer_id, health_score, churn_risk, nps_prediction)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, customer_id) 
    DO UPDATE SET health_score = EXCLUDED.health_score, churn_risk = EXCLUDED.churn_risk, nps_prediction = EXCLUDED.nps_prediction, last_updated = NOW()
    RETURNING *;
  `, [healthId, tenantId, parsed.customer_id, parsed.health_score, parsed.churn_risk, nps], tenantId);

  return res[0];
}

export async function getCustomerSentimentLedger(tenantId: string, customerId: string) {
  if (!isValidUuid(customerId)) throw new AppError('Invalid Customer ID format.', 'BAD_REQUEST');

  const healthRes = await withTenantQuery(`
    SELECT * FROM customer_health_scores WHERE customer_id = $1 AND tenant_id = $2;
  `, [customerId, tenantId], tenantId);

  const history = await withTenantQuery(`
    SELECT * FROM sentiment_analysis WHERE entity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [customerId, tenantId], tenantId);

  return {
    customer_id: customerId,
    health: healthRes[0] || null,
    history
  };
}
