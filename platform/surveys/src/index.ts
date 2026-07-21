import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export interface SurveyInput {
  title: string;
  description?: string;
  type?: 'general' | 'nps' | 'csat' | 'quiz' | 'assessment';
  questions: any[];
  settings?: Record<string, any>;
  theme?: Record<string, any>;
  is_anonymous?: boolean;
  response_quota?: number;
}

export interface SubmitInput {
  answers: Record<string, any>;
  time_taken_seconds?: number;
}

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) {
    return userId;
  }
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'surveys.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return {
    enabled: true,
    tiers: { auditTrail: true, npsCalculation: true },
    limits: { surveyCount: 50, questionsPerSurvey: 20 }
  };
}

export async function createSurvey(tenantId: string, userId: string, data: SurveyInput) {
  const config = loadConfig();
  if (!config.enabled) {
    throw new AppError('Surveys feature is disabled', ErrorCode.FORBIDDEN);
  }

  const cleanUserId = parseUserId(userId);

  const countResult = await withTenantQuery(
    "SELECT COUNT(*) as count FROM surveys WHERE tenant_id = $1 AND deleted_at IS NULL",
    [tenantId],
    tenantId
  );
  
  const currentCount = parseInt(countResult[0]?.count || '0', 10);
  if (currentCount >= config.limits.surveyCount) {
    throw new AppError('Survey limit for current tier reached', ErrorCode.FORBIDDEN);
  }

  if (data.questions.length > config.limits.questionsPerSurvey) {
    throw new AppError('Maximum questions per survey exceeded', ErrorCode.BAD_REQUEST);
  }

  const surveyId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO surveys (id, tenant_id, created_by, title, description, type, questions, settings, theme, is_anonymous, response_quota, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
    RETURNING *;
  `;
  const params = [
    surveyId,
    tenantId,
    cleanUserId,
    data.title,
    data.description || null,
    data.type || 'general',
    JSON.stringify(data.questions || []),
    JSON.stringify(data.settings || {}),
    JSON.stringify(data.theme || {}),
    data.is_anonymous !== false,
    data.response_quota || null
  ];

  const result = await withTenantQuery(insertQuery, params, tenantId);
  return result[0];
}

export async function submitSurveyResponse(tenantId: string, surveyId: string, input: SubmitInput, meta: { ip?: string; userAgent?: string }) {
  const config = loadConfig();
  if (!config.enabled) {
    throw new AppError('Surveys feature is disabled', ErrorCode.FORBIDDEN);
  }

  const surveys = await withTenantQuery(
    "SELECT id, type, is_anonymous, response_count, response_quota, status FROM surveys WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL",
    [surveyId, tenantId],
    tenantId
  );
  
  const survey = surveys[0];
  if (!survey) {
    throw new AppError('Survey not found or inactive', ErrorCode.NOT_FOUND);
  }
  if (survey.status !== 'active') {
    throw new AppError('Survey is no longer active', ErrorCode.BAD_REQUEST);
  }

  if (survey.response_quota && survey.response_count >= survey.response_quota) {
    throw new AppError('Survey response quota has been reached', ErrorCode.FORBIDDEN);
  }

  let npsScore: number | null = null;
  if (survey.type === 'nps') {
    const firstVal = Object.values(input.answers)[0];
    const parsed = parseInt(firstVal as any, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 10) {
      npsScore = parsed;
    }
  }

  const responseId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO survey_responses (id, tenant_id, survey_id, answers, nps_score, time_taken_seconds, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;
  const params = [
    responseId,
    tenantId,
    surveyId,
    JSON.stringify(input.answers),
    npsScore,
    input.time_taken_seconds || null,
    meta.ip || null,
    meta.userAgent || null
  ];

  const result = await withTenantQuery(insertQuery, params, tenantId);

  await withTenantQuery(
    "UPDATE surveys SET response_count = response_count + 1 WHERE id = $1 AND tenant_id = $2",
    [surveyId, tenantId],
    tenantId
  );

  return result[0];
}

export async function calculateNpsScore(tenantId: string, surveyId: string) {
  const config = loadConfig();
  if (!config.tiers.npsCalculation) {
    throw new AppError('NPS calculation not available in current tier', ErrorCode.FORBIDDEN);
  }

  const responses = await withTenantQuery(
    "SELECT nps_score FROM survey_responses WHERE survey_id = $1 AND tenant_id = $2 AND completed = true",
    [surveyId, tenantId],
    tenantId
  );

  const scores = responses.map((r: any) => r.nps_score).filter((s: any) => s !== null && s !== undefined) as number[];
  const promoters = scores.filter(s => s >= 9).length;
  const detractors = scores.filter(s => s <= 6).length;
  const total = scores.length;

  const score = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

  return {
    score,
    promoters,
    passives: total - promoters - detractors,
    detractors,
    total
  };
}
