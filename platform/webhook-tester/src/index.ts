/**
 * @platform/webhook-tester
 *
 * Send test webhooks and record results.
 * HTTP transport is injected (HttpSender) so the core stays pure/testable.
 * Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { createHmac } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const SendWebhookSchema = z.object({
  target_url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  headers: z.record(z.string()).optional().nullable(),
  body: z.unknown().optional().nullable(),
  signing_secret: z.string().min(1).optional().nullable(),
  timeout_ms: z.number().int().positive().max(60000).optional(),
});

export interface HttpSenderResult {
  status_code: number;
  headers: Record<string, string>;
  body: string;
  duration_ms: number;
}

export type HttpSender = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeout_ms: number;
}) => Promise<HttpSenderResult>;

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'webhook-tester');
  if (!cfg.enabled) {
    throw new AppError('Webhook tester is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

async function requireTier(tenantId: string, feature: string) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.[feature]) {
    throw new AppError(`Feature ${feature} not available in current tier`, ErrorCode.FORBIDDEN);
  }
  return cfg;
}

export async function sendTestWebhook(
  tenantId: string,
  input: unknown,
  createdBy: string,
  sender: HttpSender,
) {
  const cfg = await requireTier(tenantId, 'sendTest');
  const parsed = SendWebhookSchema.parse(input);

  if (parsed.headers && Object.keys(parsed.headers).length > 0) {
    await requireTier(tenantId, 'customHeaders');
  }
  if (parsed.signing_secret) {
    await requireTier(tenantId, 'signedPayloads');
  }

  const bodyStr =
    parsed.body === undefined || parsed.body === null
      ? undefined
      : typeof parsed.body === 'string'
        ? parsed.body
        : JSON.stringify(parsed.body);

  if (bodyStr && Buffer.byteLength(bodyStr, 'utf8') > (cfg.limits?.maxBodyBytes ?? 65536)) {
    throw new AppError('Request body too large', ErrorCode.BAD_REQUEST);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(parsed.headers ?? {}),
  };

  if (parsed.signing_secret && bodyStr) {
    const sig = createHmac('sha256', parsed.signing_secret).update(bodyStr).digest('hex');
    headers['x-webhook-signature'] = `sha256=${sig}`;
  }

  const timeout = parsed.timeout_ms ?? cfg.limits?.defaultTimeoutMs ?? 10000;

  let statusCode: number | null = null;
  let responseHeaders: Record<string, string> | null = null;
  let responseBody: string | null = null;
  let durationMs: number | null = null;
  let success = false;
  let errorMessage: string | null = null;

  try {
    const res = await sender({
      url: parsed.target_url,
      method: parsed.method,
      headers,
      body: bodyStr,
      timeout_ms: timeout,
    });
    statusCode = res.status_code;
    responseHeaders = res.headers;
    responseBody = res.body;
    durationMs = res.duration_ms;
    success = res.status_code >= 200 && res.status_code < 300;
  } catch (err: any) {
    errorMessage = err instanceof Error ? err.message : String(err);
    success = false;
  }

  if (cfg.tiers?.recordHistory !== false) {
    await requireTier(tenantId, 'recordHistory').catch(() => null);
  }

  const rows = await withTenantQuery(
    `INSERT INTO webhook_test_runs (
       tenant_id, target_url, method, request_headers, request_body,
       status_code, response_headers, response_body, duration_ms,
       success, error_message, created_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      tenantId,
      parsed.target_url,
      parsed.method,
      JSON.stringify(headers),
      bodyStr ? bodyStr : null,
      statusCode,
      responseHeaders ? JSON.stringify(responseHeaders) : null,
      responseBody,
      durationMs,
      success,
      errorMessage,
      createdBy,
    ],
    tenantId,
  );

  return rows[0];
}

export async function listTestRuns(tenantId: string, limit = 50) {
  await requireTier(tenantId, 'recordHistory');
  const cfg = await getTierConfig(tenantId, 'webhook-tester');
  const max = cfg.limits?.maxHistoryPerTenant ?? 500;
  const safeLimit = Math.min(Math.max(1, limit), Math.min(200, max));

  return withTenantQuery(
    `SELECT * FROM webhook_test_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, safeLimit],
    tenantId,
  );
}

export async function getTestRun(tenantId: string, runId: string) {
  await requireEnabled(tenantId);
  if (!isValidUuid(runId)) {
    throw new AppError('Invalid run id', ErrorCode.BAD_REQUEST);
  }
  const rows = await withTenantQuery(
    `SELECT * FROM webhook_test_runs WHERE id = $1 AND tenant_id = $2`,
    [runId, tenantId],
    tenantId,
  );
  if (!rows.length) throw new AppError('Test run not found', ErrorCode.NOT_FOUND);
  return rows[0];
}
