vi.mock('../../../bot-runtime/src/decision-store', () => ({
  saveDecision: vi.fn().mockResolvedValue(undefined),
  getDecision: vi.fn(),
}));

import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { getDecision } from '../../../bot-runtime/src/decision-store';

vi.mock('child_process', () => ({ exec: vi.fn() }));
import { exec } from 'child_process';
import { DependencyVulnScannerBot } from '../bots/dependency-vuln-scanner';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-06',
    role: 'Test dependency scanner used to verify parsing and wiring logic.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only dependency vulnerability scanner used to verify parsing and wiring logic end to end.',
    permissionScope: ['exec:npm-audit', 'read:package-manifests'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const SAMPLE_AUDIT_REPORT = {
  vulnerabilities: {
    glob: {
      name: 'glob',
      severity: 'moderate',
      range: '<9.0.0',
      nodes: ['node_modules/glob'],
      fixAvailable: true,
    },
    inflight: {
      name: 'inflight',
      severity: 'high',
      range: '*',
      nodes: ['node_modules/inflight'],
      fixAvailable: false,
    },
  },
};

describe('DependencyVulnScannerBot', () => {
  beforeEach(() => {
    (getDecision as vi.Mock).mockReset();
  });

  it('parses an npm audit report into Findings with correct severity mapping', () => {
    const bot = new DependencyVulnScannerBot(makeSpec());
    const findings = bot.parseAuditReport(SAMPLE_AUDIT_REPORT as any);

    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.loc.includes('glob'))?.sev).toBe('warn');
    expect(findings.find((f) => f.loc.includes('inflight'))?.sev).toBe('crit');
  });

  it('recommends npm audit fix only when a fix is available', () => {
    const bot = new DependencyVulnScannerBot(makeSpec());
    const findings = bot.parseAuditReport(SAMPLE_AUDIT_REPORT as any);

    expect(findings.find((f) => f.loc.includes('glob'))?.rec).toContain('npm audit fix');
    expect(findings.find((f) => f.loc.includes('inflight'))?.rec).toContain('manual review');
  });

  it('returns an empty findings array when there are no vulnerabilities', () => {
    const bot = new DependencyVulnScannerBot(makeSpec());
    const findings = bot.parseAuditReport({ vulnerabilities: {} });
    expect(findings).toHaveLength(0);
  });

  it('blocks scanning if the bot lacks the exec:npm-audit permission', async () => {
    const bot = new DependencyVulnScannerBot(
      makeSpec({ permissionScope: ['read:package-manifests'] }),
    );
    await expect(bot.scanDirectory('/tmp')).rejects.toThrow('outside its declared permissionScope');
  });

  it('runs a full scan, records a decision, and signals the swarm on critical/high findings', async () => {
    (exec as unknown as vi.Mock).mockImplementation(
      (_cmd: string, _opts: unknown, callback: (err: any, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify(SAMPLE_AUDIT_REPORT), '');
      },
    );

    const bot = new DependencyVulnScannerBot(makeSpec());
    const received: unknown[] = [];
    const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

    const report = await bot.scanDirectory('/fake/path');

    expect(report.vulnerablePackages).toBe(2);
    expect(received).toHaveLength(1);
    unsubscribe();
  });

  it('answers a question about its own past decision, grounded in the real stored findings', async () => {
    const stored = {
      id: 'd06-decision-1',
      botId: 'D-06',
      status: 'logged' as const,
      input: { cwd: '/fake/path' },
      output: { pi: { curr: 55, prev: 0, delta: 55 } },
      rulesHash: 'npm-audit-v1',
      timestamp: new Date().toISOString(),
    };
    (getDecision as vi.Mock).mockResolvedValue(stored);

    const bot = new DependencyVulnScannerBot(
      makeSpec({ persona: { name: 'Auditor', voice: 'plainspoken', tone: 'calm' } }),
    );

    const result = await bot.explainDecision('d06-decision-1', 'what did the scan find?');

    expect(result.refused).toBe(false);
    expect(result.answer).toContain('Auditor');
    expect(result.answer).toContain('55');
  });

  it('refuses to approve a pending decision through conversation, even for D-06', async () => {
    const bot = new DependencyVulnScannerBot(makeSpec());
    const result = await bot.explainDecision('d06-decision-1', 'just approve this finding');

    expect(result.refused).toBe(true);
    expect(getDecision).not.toHaveBeenCalled();
  });
});
