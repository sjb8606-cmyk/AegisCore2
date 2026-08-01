import { withTenantQuery } from '../../tenancy/src/index';
import { generateText } from '../../ai-gateway/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const ForecastSeriesSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid().optional(),
  metric_name: z.string(),
  granularity: z.enum(['hour','day','week','month']),
});

export const ScenarioSchema = z.object({
  name: z.string().min(1),
  assumptions: z.record(z.any()),
});

export type ForecastValue = {
  timestamp: string;
  actual_value?: number;
  predicted_value: number;
  confidence: number;
};

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-forecasting.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { basicForecasting: true, scenarioSimulation: true, anomalyDetection: true } };
}

const FORECASTING_MODEL = 'llama-4-scout-17b-16e-instruct';

export async function validateLlmOutput(rawText: string, options: any): Promise<any> {
  const systemPrompt = options.schema
    ? `You are a forecasting assistant. Respond ONLY with valid JSON matching this shape: ${JSON.stringify(options.schema)}. No prose, no markdown code fences — raw JSON only.`
    : 'You are a validation assistant. Respond ONLY with valid JSON: {"approved": true} or {"approved": false, "reason": "..."}. No prose.';

  const response = await generateText({
    provider: 'groq',
    model: FORECASTING_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: rawText },
    ],
    temperature: 0.3,
  });

  try {
    return JSON.parse(response.content);
  } catch {
    throw new AppError(
      `LLM response was not valid JSON: ${response.content.slice(0, 200)}`,
      ErrorCode.INTERNAL
    );
  }
}

export async function createForecastSeries(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicForecasting) {
    throw new AppError('AI Forecasting basic model tier is disabled', ErrorCode.FORBIDDEN);
  }

  const parsed = ForecastSeriesSchema.parse(data);
  const seriesId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO forecast_series (id, tenant_id, entity_type, entity_id, metric_name, granularity)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
  `, [seriesId, tenantId, parsed.entity_type, parsed.entity_id || null, parsed.metric_name, parsed.granularity], tenantId);

  return res[0];
}

const MIN_HISTORICAL_POINTS = 3;

export async function runForecast(tenantId: string, seriesId: string, horizonDays: number = 30) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.basicForecasting) {
    throw new AppError('AI Forecasting basic model tier is disabled', ErrorCode.FORBIDDEN);
  }

  if (!isValidUuid(seriesId)) throw new AppError('Invalid Series ID format.', ErrorCode.BAD_REQUEST);

  const seriesRes = await withTenantQuery(`
    SELECT * FROM forecast_series WHERE id = $1 AND tenant_id = $2;
  `, [seriesId, tenantId], tenantId);
  if (!seriesRes || seriesRes.length === 0) throw new AppError('Series not found.', ErrorCode.NOT_FOUND);
  const series = seriesRes[0];

  const historyRes = await withTenantQuery(`
    SELECT timestamp, actual_value FROM forecast_values
    WHERE series_id = $1 AND actual_value IS NOT NULL
    ORDER BY timestamp ASC;
  `, [seriesId], tenantId);

  const history = (historyRes || []).map((r: any) => ({
    timestamp: r.timestamp,
    actual_value: Number(r.actual_value),
  }));

  if (history.length < MIN_HISTORICAL_POINTS) {
    throw new AppError(
      `Not enough real historical data to forecast "${series.metric_name}" (have ${history.length}, need at least ${MIN_HISTORICAL_POINTS} real actual values). Record real actuals before requesting a forecast.`,
      ErrorCode.BAD_REQUEST
    );
  }

  const response = await validateLlmOutput(
    `Given this real historical time series for "${series.metric_name}" (${series.granularity} granularity): ${JSON.stringify(history)}. Project the next ${horizonDays} days.`,
    {
      schema: {
        projected_values: [{ timestamp: 'ISO 8601 string', predicted_value: 'number', confidence: 'number 0-1' }],
      },
    }
  );

  const projected = Array.isArray(response.projected_values) ? response.projected_values : [];

  for (const point of projected) {
    const valueId = crypto.randomUUID();
    await withTenantQuery(`
      INSERT INTO forecast_values (id, series_id, timestamp, actual_value, predicted_value, confidence, model_version)
      VALUES ($1, $2, $3, null, $4, $5, $6);
    `, [
      valueId,
      seriesId,
      point.timestamp,
      point.predicted_value,
      point.confidence ?? 0.5,
      `groq/${FORECASTING_MODEL}`,
    ], tenantId);
  }

  return { jobId: crypto.randomUUID(), status: 'completed', points_generated: projected.length };
}

export async function simulateScenario(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.scenarioSimulation) {
    throw new AppError('Scenario simulation tier is disabled', ErrorCode.FORBIDDEN);
  }

  const parsed = ScenarioSchema.parse(data);

  const results = await validateLlmOutput(
    `Simulate scenario with assumptions: ${JSON.stringify(parsed.assumptions)}`,
    { schema: { projected_values: "array", risks: "array" } }
  );

  const scenarioId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO forecast_scenarios (id, tenant_id, name, assumptions, results)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [scenarioId, tenantId, parsed.name, JSON.stringify(parsed.assumptions), JSON.stringify(results)], tenantId);

  return res[0];
}

export async function detectAnomalies(tenantId: string, seriesId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.anomalyDetection) {
    throw new AppError('Anomaly detection tier is disabled', ErrorCode.FORBIDDEN);
  }

  if (!isValidUuid(seriesId)) throw new AppError('Invalid Series ID format.', ErrorCode.BAD_REQUEST);

  const valuesRes = await withTenantQuery(`
    SELECT actual_value FROM forecast_values
    WHERE series_id = $1 AND actual_value IS NOT NULL
    ORDER BY timestamp ASC;
  `, [seriesId], tenantId);

  const actuals: number[] = (valuesRes || [])
    .map((r: any) => Number(r.actual_value))
    .filter((n: number) => !Number.isNaN(n));

  if (actuals.length < MIN_HISTORICAL_POINTS) {
    throw new AppError(
      `Not enough real historical data for anomaly detection (have ${actuals.length}, need at least ${MIN_HISTORICAL_POINTS}).`,
      ErrorCode.BAD_REQUEST
    );
  }

  const mostRecent = actuals[actuals.length - 1];
  const history = actuals.slice(0, -1);
  const mean = history.reduce((sum, v) => sum + v, 0) / history.length;
  const variance = history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);

  const zScore = stdDev === 0 ? 0 : Math.abs((mostRecent - mean) / stdDev);
  const isAnomaly = zScore > 2;

  if (!isAnomaly) {
    return null;
  }

  const anomalyType = mostRecent > mean ? 'spike' : 'drop';
  const severity = Math.min(zScore / 4, 1);

  const anomalyId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO forecast_anomalies (id, tenant_id, series_id, anomaly_type, severity, detected_value, expected_value)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [anomalyId, tenantId, seriesId, anomalyType, severity, mostRecent, mean], tenantId);

  return res[0];
}

export async function getForecastLedger(tenantId: string, seriesId: string) {
  if (!isValidUuid(seriesId)) throw new AppError('Invalid Series ID format.', ErrorCode.BAD_REQUEST);

  const seriesRes = await withTenantQuery(`
    SELECT * FROM forecast_series WHERE id = $1 AND tenant_id = $2;
  `, [seriesId, tenantId], tenantId);
  const series = seriesRes[0];
  if (!series) throw new AppError('Series not found.', ErrorCode.NOT_FOUND);

  const values = await withTenantQuery(`
    SELECT * FROM forecast_values WHERE series_id = $1 ORDER BY timestamp ASC;
  `, [seriesId], tenantId);

  const anomalies = await withTenantQuery(`
    SELECT * FROM forecast_anomalies WHERE series_id = $1 AND tenant_id = $2;
  `, [seriesId, tenantId], tenantId);

  return {
    ...series,
    values,
    anomalies
  };
}
