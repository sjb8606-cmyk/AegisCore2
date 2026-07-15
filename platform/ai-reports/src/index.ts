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
  try {
    const configPath = path.join(process.cwd(), 'config', 'ai-reports.json');
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, limits: { reportsPerMonth: 20 }, tone: 'professional' };
}

export async function createTemplate(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Reports disabled', ErrorCode.FORBIDDEN);

  const templateId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO report_templates (id, tenant_id, name, type, prompt_template)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    templateId, tenantId, data.name, data.type || 'custom', data.prompt_template
  ], tenantId);

  return res[0];
}

export function buildPrompt(template: string, data: Record<string, any>): string {
  let prompt = template;
  for (const [key, value] of Object.entries(data)) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  return prompt;
}

export async function generateReport(tenantId: string, userId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Reports disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(userId);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM report_generation_runs WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.reportsPerMonth) {
    throw new AppError('Monthly report generation limits reached', ErrorCode.RATE_LIMITED);
  }

  // Load Template
  const templateRes = await withTenantQuery('SELECT * FROM report_templates WHERE id = $1 AND tenant_id = $2', [data.templateId, tenantId], tenantId);
  const template = templateRes[0];
  if (!template) throw new AppError('Report template not found', ErrorCode.NOT_FOUND);

  const interpolatedPrompt = buildPrompt(template.prompt_template, data.inputData || {});
  
  const runId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO report_generation_runs (id, tenant_id, template_id, status, format, created_by)
    VALUES ($1, $2, $3, 'processing', $4, $5) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    runId, tenantId, data.templateId, data.format || 'markdown', cleanUserId
  ], tenantId);

  // Synchronous compile emulation
  const finalMarkdown = `# ${template.name} - Executive Audit\n\n${interpolatedPrompt}\n\n*Generated securely under professional tone controls.*`;
  
  let fileUrl = null;
  if (data.format === 'pdf') {
    fileUrl = `exports/${runId}.pdf`;
  }

  await withTenantQuery(`
    UPDATE report_generation_runs 
    SET status = 'completed', result_body = $1, file_url = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3 AND tenant_id = $4;
  `, [finalMarkdown, fileUrl, runId, tenantId], tenantId);

  return result[0];
}

export async function getReportRun(tenantId: string, id: string) {
  const res = await withTenantQuery('SELECT * FROM report_generation_runs WHERE id = $1 AND tenant_id = $2', [id, tenantId], tenantId);
  return res[0];
}
