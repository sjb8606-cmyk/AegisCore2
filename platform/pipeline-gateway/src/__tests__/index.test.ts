/**
 * pipeline-gateway tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      webhookSecretEnv: 'CRUCIBLE_WEBHOOK_SECRET',
      maxBodyBytes: 1_048_576,
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  handleWebhook,
  verifyWebhookSignature,
  type CrucibleBots,
  type BotRunResult,
  type PipelineFinding,
} from '../index';

const SECRET = 'test-webhook-secret';

function sign(body: Buffer, secret = SECRET): string {
  const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

function botResult(botId: string, findings: PipelineFinding[] = []): BotRunResult {
  return { botId, ok: true, findings, durationMs: 1 };
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid sha256= signature', () => {
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a bad signature', () => {
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    expect(verifyWebhookSignature(body, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('rejects missing signature', () => {
    const body = Buffer.from('{}');
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
  });
});

describe('handleWebhook', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const actorId = 'service:ci';

  beforeEach(() => {
    process.env.CRUCIBLE_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
  });

  it('rejects unsigned payloads', async () => {
    const body = Buffer.from('{"x":1}');
    await expect(
      handleWebhook(tenantId, actorId, { rawBody: body, headers: {} }),
    ).rejects.toThrow(/signature/i);
  });

  it('runs full sequence on push and returns one combined report', async () => {
    const order: string[] = [];
    const bots: CrucibleBots = {
      runSupplyChainCartographer: async () => {
        order.push('D-02');
        return botResult('supply-chain-cartographer');
      },
      runDependencyVulnScanner: async () => {
        order.push('D-06');
        return botResult('dependency-vuln-scanner');
      },
      runSecretsExposureDetector: async () => {
        order.push('D-16');
        return botResult('secrets-exposure-detector');
      },
      runBuildIntegrityVerifier: async () => {
        order.push('D-17');
        return botResult('build-integrity-verifier');
      },
    };

    const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    const report = await handleWebhook(
      tenantId,
      actorId,
      {
        rawBody: body,
        headers: { signature256: sign(body), event: 'push' },
      },
      bots,
    );

    expect(order).toEqual(['D-02', 'D-06', 'D-16', 'D-17']);
    expect(report.runs).toHaveLength(4);
    expect(report.autoBlocked).toBe(false);
    expect(report.hasBlockSeverity).toBe(false);
  });

  it('on deploy runs only build-integrity-verifier', async () => {
    const order: string[] = [];
    const bots: CrucibleBots = {
      runSupplyChainCartographer: async () => {
        order.push('D-02');
        return botResult('supply-chain-cartographer');
      },
      runBuildIntegrityVerifier: async () => {
        order.push('D-17');
        return botResult('build-integrity-verifier');
      },
    };

    const body = Buffer.from(JSON.stringify({ deployment: true }));
    const report = await handleWebhook(
      tenantId,
      actorId,
      {
        rawBody: body,
        headers: { signature256: sign(body), event: 'deployment' },
        kind: 'deploy',
      },
      bots,
    );

    expect(order).toEqual(['D-17']);
    expect(report.runs).toHaveLength(1);
    expect(report.autoBlocked).toBe(false);
  });

  it('surfaces block-severity findings but never auto-blocks', async () => {
    const bots: CrucibleBots = {
      runSupplyChainCartographer: async () =>
        botResult('supply-chain-cartographer', [{
          source: 'supply-chain-cartographer',
          severity: 'block',
          location: 'pkg:evil@1.0.0',
          description: 'Known malicious package',
        }]),
      runDependencyVulnScanner: async () => botResult('dependency-vuln-scanner'),
      runSecretsExposureDetector: async () => botResult('secrets-exposure-detector'),
      runBuildIntegrityVerifier: async () => botResult('build-integrity-verifier'),
    };

    const body = Buffer.from('{}');
    const report = await handleWebhook(
      tenantId,
      actorId,
      {
        rawBody: body,
        headers: { signature256: sign(body), event: 'push' },
      },
      bots,
    );

    expect(report.hasBlockSeverity).toBe(true);
    expect(report.autoBlocked).toBe(false);
    expect(report.summary).toMatch(/Human decision required/i);
  });
});
