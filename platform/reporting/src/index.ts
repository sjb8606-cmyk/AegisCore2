import { withTenantQuery } from '../../tenancy/src/index';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'reporting.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { executiveDashboard: true }, limits: { reportCount: 20 } };
}

export function generateNativeCsv(data: any[]): Buffer {
  if (!data || data.length === 0) return Buffer.from('No records found');
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(row => 
    Object.values(row).map(val => {
      const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return valStr.includes(',') ? `"${valStr.replace(/"/g, '""')}"` : valStr;
    }).join(',')
  ).join('\n');
  return Buffer.from(`${headers}\n${rows}`);
}

export async function createReport(tenantId: string, createdBy: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Reporting vertical disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(createdBy);

  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM report_definitions WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.reportCount) {
    throw new AppError('Report definition limit reached', ErrorCode.FORBIDDEN);
  }

  const reportId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO report_definitions (id, tenant_id, created_by, name, description, type, config)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    reportId, tenantId, cleanUserId, data.name, data.description || null, data.type, JSON.stringify(data.config || {})
  ], tenantId);

  return result[0];
}

type ReportTypeHandler = (tenantId: string, config: Record<string, unknown>) => Promise<any[]>;

const REPORT_TYPE_HANDLERS: Record<string, ReportTypeHandler> = {
  // e.g. 'catch_summary': async (tenantId, config) => { ...real query... },
};

export async function runReport(tenantId: string, reportId: string, triggeredBy: string) {
  const cleanUserId = parseUserId(triggeredBy);
  const runId = crypto.randomUUID();

  const defRes = await withTenantQuery(
    'SELECT * FROM report_definitions WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [reportId, tenantId],
    tenantId
  );
  const definition = defRes[0];
  if (!definition) {
    throw new AppError(`Report definition ${reportId} not found`, ErrorCode.NOT_FOUND);
  }

  await withTenantQuery(`
    INSERT INTO report_runs (id, tenant_id, report_id, status, triggered_by)
    VALUES ($1, $2, $3, 'running', $4) RETURNING id;
  `, [runId, tenantId, reportId, cleanUserId], tenantId);

  const handler = REPORT_TYPE_HANDLERS[definition.type];
  if (!handler) {
    await withTenantQuery(`
      UPDATE report_runs
      SET status = 'failed', completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2;
    `, [runId, tenantId], tenantId);

    throw new AppError(
      `Report type "${definition.type}" has no real data handler wired up yet.`,
      ErrorCode.NOT_IMPLEMENTED
    );
  }

  const start = Date.now();
  const reportData = await handler(tenantId, definition.config || {});
  const csvBuffer = generateNativeCsv(reportData);
  const duration = Date.now() - start;

  await withTenantQuery(`
    UPDATE report_runs 
    SET status = 'completed', file_url = $1, row_count = $2, duration_ms = $3, completed_at = CURRENT_TIMESTAMP
    WHERE id = $4 AND tenant_id = $5;
  `, [`reports/${runId}.csv`, reportData.length, duration, runId, tenantId], tenantId);

  return { runId, status: 'completed', duration_ms: duration, records_processed: reportData.length };
}

export async function getReportRun(tenantId: string, runId: string) {
  const res = await withTenantQuery('SELECT * FROM report_runs WHERE id = $1 AND tenant_id = $2', [runId, tenantId], tenantId);
  return res[0];
}

export async function getExecutiveDashboard(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.executiveDashboard) throw new AppError('Dashboard is premium tier only', ErrorCode.FORBIDDEN);

  throw new AppError(
    'Executive dashboard has no real KPI data source wired up yet.',
    ErrorCode.NOT_IMPLEMENTED
  );
}
