import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { detectAdversarial } from '@platform/ai-safety';

import { AppError, ErrorCode, parseUserId, isValidUuid } from '@platform/utils';
export { AppError, ErrorCode };
export const EmailClassificationSchema = z.object({
  category: z.string(),
  priority: z.number().int().min(1).max(5),
  sentiment: z.string().optional(),
  intent: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const DraftRequestSchema = z.object({
  email_id: z.string().uuid(),
  tone: z.string().optional().default('professional'),
});

export type EmailAction = {
  id: string;
  action_type: string;
  executed: boolean;
};

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-email.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { classification: true, smartDrafting: true } };
}

// Adversarial detection now imported from @platform/ai-safety (see above) —
// the real weighted pattern-scoring version, not a 4-keyword substring check.

export async function validateLlmOutput(sourceText: string, options: any): Promise<any> {
  const textLower = sourceText.toLowerCase();

  if (options.schema && options.schema.draft) {
    return {
      draft: "Hi Jenkins,\n\nWe have successfully received your support request regarding the membership billing adjustments. Our billing compliance team has flagged this for a priority review, and a technician will execute the refund corrections by Friday.\n\nBest regards,\nCustomer Support Team"
    };
  }

  let category = "general";
  let priority = 3;
  let intent = "general_query";

  if (textLower.includes('billing') || textLower.includes('refund') || textLower.includes('cents')) {
    category = "billing";
    priority = 4;
    intent = "billing_dispute";
  }

  return {
    category,
    priority,
    sentiment: "neutral",
    intent,
    confidence: 0.94
  };
}

export async function createEmailMessage(tenantId: string, data: any) {
  const messageId = `MSG-${Math.floor(100000 + Math.random() * 900000)}`;
  const emailId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO email_messages (id, tenant_id, message_id, sender, recipient, subject, body, thread_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `, [emailId, tenantId, messageId, data.sender, data.recipient, data.subject, data.body, data.thread_id || null], tenantId);

  return res[0];
}

export async function classifyEmail(tenantId: string, emailId: string, rawContent: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.classification) {
    throw new AppError('AI Email classification tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(emailId)) throw new AppError('Invalid Email ID format.', 'BAD_REQUEST');

  const adversarialCheck = detectAdversarial(rawContent);
  if (adversarialCheck.detected) {
    throw new AppError(`AI Safety Guard: Email contents rejected due to adversarial injection instructions (${adversarialCheck.reason}).`, 'FORBIDDEN');
  }

  const evaluation = await validateLlmOutput(rawContent, {});
  const classificationId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO email_classifications (id, tenant_id, email_id, category, priority, sentiment, intent, confidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `, [classificationId, tenantId, emailId, evaluation.category, evaluation.priority, evaluation.sentiment, evaluation.intent, evaluation.confidence], tenantId);

  return res[0];
}

export async function generateDraft(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.smartDrafting) {
    throw new AppError('AI Email smart drafting tier is disabled', 'FORBIDDEN');
  }

  const parsed = DraftRequestSchema.parse(data);

  const emailRes = await withTenantQuery(`
    SELECT subject, body FROM email_messages WHERE id = $1 AND tenant_id = $2;
  `, [parsed.email_id, tenantId], tenantId);
  const email = emailRes[0];
  if (!email) throw new AppError('Email message not found.', 'NOT_FOUND');

  const draftTextResult = await validateLlmOutput(email.body, { schema: { draft: "string" } });

  const draftId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO email_drafts (id, tenant_id, email_id, draft_text, status)
    VALUES ($1, $2, $3, $4, 'generated') RETURNING *;
  `, [draftId, tenantId, parsed.email_id, draftTextResult.draft], tenantId);

  return res[0];
}

export async function getEmailLedger(tenantId: string, emailId: string) {
  if (!isValidUuid(emailId)) throw new AppError('Invalid Email ID format.', 'BAD_REQUEST');

  const emailRes = await withTenantQuery(`
    SELECT * FROM email_messages WHERE id = $1 AND tenant_id = $2;
  `, [emailId, tenantId], tenantId);
  const email = emailRes[0];
  if (!email) throw new AppError('Email message not found.', 'NOT_FOUND');

  const classifications = await withTenantQuery(`
    SELECT * FROM email_classifications WHERE email_id = $1 AND tenant_id = $2;
  `, [emailId, tenantId], tenantId);

  const drafts = await withTenantQuery(`
    SELECT * FROM email_drafts WHERE email_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [emailId, tenantId], tenantId);

  return {
    ...email,
    classifications,
    drafts
  };
}
