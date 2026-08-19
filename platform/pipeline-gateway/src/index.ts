/**
 * platform/pipeline-gateway
 *
 * D-25 · Pipeline Trigger Gateway
 *
 * Receives CI/webhook events, verifies signatures, then runs the
 * Crucible bot sequence and returns ONE combined report.
 *
 * - Always verify webhook signatures
 * - On push/build: D-02 → D-06 → D-16 → D-17
 * - On deploy: D-17 only
 * - Never auto-block a deploy
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('pipeline-gateway');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  webhookSecretEnv: z.string().default('CRUCIBLE_WEBHOOK_SECRET'),
  maxBodyBytes: z.number().int().positive().default(1_048_576),
});

export type PipelineGatewayConfig = z.infer<typeof ConfigSchema>;

export type TriggerKind = 'push' | 'pull_request' | 'deploy' | 'generic';

export interface WebhookHeaders {
  signature256?: string;
  crucibleSignature?: string;
  event?: string;
  contentType?: string;
}

export interface TriggerRequest {
  rawBody: Buffer;
  headers: WebhookHeaders;
  kind?: TriggerKind;
}

export type FindingSeverity = 'block' | 'crit' | 'warn' | 'info';

export interface PipelineFinding {
  source:
    | 'supply-chain-cartographer'
    | 'dependency-vuln-scanner'
    | 'secrets-exposure-detector'
    | 'build-integrity-verifier'
    | 'gateway';
  severity: FindingSeverity;
  location: string;
  description: string;
  recommendation?: string;
}

export interface BotRunResult {
  botId: string;
  ok: boolean;
  findings: PipelineFinding[];
  durationMs: number;
  error?: string;
}

export interface CombinedReport {
  triggerId: string;
  kind: TriggerKind;
  receivedAt: string;
  completedAt: string;
  runs: BotRunResult[];
  findings: PipelineFinding[];
  hasBlockSeverity: boolean;
  autoBlocked: false;
  summary: string;
}

export interface BotContext {
  tenantId: string;
  actorId: string;
  triggerId: string;
  kind: TriggerKind;
  payload?: unknown;
}

export interface CrucibleBots {
  runSupplyChainCartographer?: (ctx: BotContext) => Promise<BotRunResult>;
  runDependencyVulnScanner?: (ctx: BotContext) => Promise<BotRunResult>;
  runSecretsExposureDetector?: (ctx: BotContext) => Promise<BotRunResult>;
  runBuildIntegrityVerifier?: (ctx: BotContext) => Promise<BotRunResult>;
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length).trim()
    : signatureHeader.trim();

  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function resolveSignatureHeader(headers: WebhookHeaders): string | undefined {
  return headers.signature256 || headers.crucibleSignature;
}

function inferKind(headers: WebhookHeaders, explicit?: TriggerKind): TriggerKind {
  if (explicit) return explicit;
  const event = (headers.event || '').toLowerCase();
  if (event === 'push') return 'push';
  if (event === 'pull_request') return 'pull_request';
  if (event === 'deployment' || event === 'deploy') return 'deploy';
  return 'generic';
}

function emptyResult(botId: string, reason: string): BotRunResult {
  return {
    botId,
    ok: false,
    findings: [{
      source: 'gateway',
      severity: 'warn',
      location: botId,
      description: reason,
      recommendation: 'Wire the bot implementation into the gateway ports',
    }],
    durationMs: 0,
    error: reason,
  };
}

async function runSequence(
  kind: TriggerKind,
  ctx: BotContext,
  bots: CrucibleBots,
): Promise<BotRunResult[]> {
  const runs: BotRunResult[] = [];

  const timed = async (
    botId: string,
    fn?: (c: BotContext) => Promise<BotRunResult>,
  ): Promise<BotRunResult> => {
    if (!fn) return emptyResult(botId, botId + ' not configured');
    const start = Date.now();
    try {
      const result = await fn(ctx);
      return { ...result, durationMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, botId }, 'Bot execution failed');
      return {
        botId,
        ok: false,
        findings: [{
          source: 'gateway',
          severity: 'crit',
          location: botId,
          description: 'Bot threw: ' + message,
        }],
        durationMs: Date.now() - start,
        error: message,
      };
    }
  };

  if (kind === 'deploy') {
    runs.push(await timed('build-integrity-verifier', bots.runBuildIntegrityVerifier));
    return runs;
  }

  runs.push(await timed('supply-chain-cartographer', bots.runSupplyChainCartographer));
  runs.push(await timed('dependency-vuln-scanner', bots.runDependencyVulnScanner));
  runs.push(await timed('secrets-exposure-detector', bots.runSecretsExposureDetector));
  runs.push(await timed('build-integrity-verifier', bots.runBuildIntegrityVerifier));
  return runs;
}

function buildReport(
  triggerId: string,
  kind: TriggerKind,
  receivedAt: string,
  runs: BotRunResult[],
): CombinedReport {
  const findings = runs.flatMap((r) => r.findings);
  const hasBlockSeverity = findings.some((f) => f.severity === 'block');
  const failed = runs.filter((r) => !r.ok).length;

  const summary = hasBlockSeverity
    ? 'BLOCK-severity findings present (' +
      String(findings.filter((f) => f.severity === 'block').length) +
      '). Human decision required — gateway did not auto-block.'
    : failed > 0
      ? 'Completed with ' + String(failed) + ' bot error(s) and ' +
        String(findings.length) + ' finding(s). No block-severity items.'
      : 'All bots completed. ' + String(findings.length) +
        ' finding(s). No block-severity items.';

  return {
    triggerId,
    kind,
    receivedAt,
    completedAt: new Date().toISOString(),
    runs,
    findings,
    hasBlockSeverity,
    autoBlocked: false,
    summary,
  };
}

export async function handleWebhook(
  tenantId: string,
  actorId: string,
  request: TriggerRequest,
  bots: CrucibleBots = {},
): Promise<CombinedReport> {
  return runCrudOperation({
    configName: 'pipeline-gateway',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('pipeline-gateway', ConfigSchema);

      if (request.rawBody.length > config.maxBodyBytes) {
        throw new AppError('Request body too large', ErrorCode.BAD_REQUEST);
      }

      const secret = process.env[config.webhookSecretEnv] || '';
      const sigHeader = resolveSignatureHeader(request.headers);

      if (!verifyWebhookSignature(request.rawBody, sigHeader, secret)) {
        logger.warn({ tenantId }, 'Webhook signature verification failed');
        throw new AppError('Invalid or missing webhook signature', ErrorCode.UNAUTHORIZED);
      }

      const kind = inferKind(request.headers, request.kind);
      const triggerId = crypto.randomUUID();
      const receivedAt = new Date().toISOString();

      let payload: unknown;
      try {
        payload = JSON.parse(request.rawBody.toString('utf8'));
      } catch {
        payload = undefined;
      }

      const ctx: BotContext = {
        tenantId,
        actorId,
        triggerId,
        kind,
        payload,
      };

      logger.info({ triggerId, kind }, 'Pipeline trigger accepted');

      const runs = await runSequence(kind, ctx, bots);
      const report = buildReport(triggerId, kind, receivedAt, runs);

      if (report.hasBlockSeverity) {
        logger.warn(
          {
            triggerId,
            blockCount: report.findings.filter((f) => f.severity === 'block').length,
          },
          'BLOCK-severity findings in pipeline report — human decision required',
        );
      }

      return report;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'pipeline_trigger',
    meterEventType: 'api_call',
  });
}

export async function handleHttpWebhook(opts: {
  tenantId: string;
  actorId: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  bots?: CrucibleBots;
}): Promise<CombinedReport> {
  const h = opts.headers;
  const pick = (name: string) => {
    const v = h[name] ?? h[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };

  return handleWebhook(
    opts.tenantId,
    opts.actorId,
    {
      rawBody: opts.rawBody,
      headers: {
        signature256: pick('x-hub-signature-256'),
        crucibleSignature: pick('x-crucible-signature'),
        event: pick('x-github-event'),
        contentType: pick('content-type'),
      },
    },
    opts.bots,
  );
}
