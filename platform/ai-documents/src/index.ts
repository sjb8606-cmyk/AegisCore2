import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-documents.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { piiDetection: true, summarization: true, extraction: true }, limits: { processingsPerMonth: 50 } };
}

// Local PII Filter Simulator stubs to keep runtime environments 100% self-contained and network-safe
export function redactPiiText(text: string): string {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
  return text.replace(emailRegex, '[REDACTED_EMAIL]').replace(phoneRegex, '[REDACTED_PHONE]');
}

export async function submitAnalysis(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Document Intelligence vertical is disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM document_analyses WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.processingsPerMonth) {
    throw new AppError('Monthly document processing limits reached', ErrorCode.RATE_LIMITED);
  }

  const analysisId = crypto.randomUUID();
  const fileId = data.fileId || crypto.randomUUID();

  // Insert Pending Analysis Job Header
  const insertQuery = `
    INSERT INTO document_analyses (id, tenant_id, file_id, operation, status, created_by)
    VALUES ($1, $2, $3, $4, 'processing', $5) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    analysisId, tenantId, fileId, data.operation, cleanUserId
  ], tenantId);

  // Synchronous mock compiler execution loop with safety sanitization
  const start = Date.now();
  const rawText = data.raw_text || "Contact John Doe at john@doe.com or call 555-123-4567 for Q2 report reviews.";
  
  let processedText = rawText;
  if (cfg.tiers.piiDetection) {
    processedText = redactPiiText(rawText);
  }

  let finalPayload: any = {};
  if (data.operation === 'summarize') {
    finalPayload = {
      summary: "Document outlines review tasks.",
      sanitized_content: processedText,
      confidence: 0.96
    };
  } else {
    finalPayload = {
      extracted_entities: ["Q2 report", "John Doe"],
      sanitized_content: processedText,
      confidence: 0.88
    };
  }

  const duration = Date.now() - start;

  // Atomically resolve the analysis state inside the database
  await withTenantQuery(`
    UPDATE document_analyses 
    SET status = 'completed', result = $1, duration_ms = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_id = $4;
  `, [JSON.stringify(finalPayload), duration, analysisId, tenantId], tenantId);

  return result[0];
}

export async function getAnalysisDetails(tenantId: string, id: string) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Document Intelligence vertical is disabled', ErrorCode.FORBIDDEN);

  const res = await withTenantQuery('SELECT * FROM document_analyses WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  return res[0];
}
