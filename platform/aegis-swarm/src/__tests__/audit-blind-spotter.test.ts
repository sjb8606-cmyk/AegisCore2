import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { AuditBlindSpotterBot } from '../redteam/audit-blind-spotter';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-18',
    role: 'Test Audit Blind Spotter used to verify the real coverage scanner against fixtures and the real bot roster.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Audit Blind Spotter used to verify accurate extraction, correct classification, and no false positives.',
    permissionScope: ['redteam:scan-audit-coverage'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_BOTS_DIR = path.join(__dirname, '..', 'bots');

describe('AuditBlindSpotterBot', () => {
  describe('scanBotDirectory — synthetic fixture (isolated unit control)', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-spot-fixture-'));
      fs.writeFileSync(
        path.join(tmpDir, 'fixture.ts'),
        `
export class FixtureBot {
  async safeMethod(x: number): Promise<number> {
    await this.enforcePermission('read:x');
    return x;
  }

  async methodWithTrickyDefaultParam(x: number, context: Record<string, unknown> = {}): Promise<number> {
    await this.enforcePermission('read:x');
    return x;
  }

  async unsafeStub(): Promise<never> {
    throw new Error('not implemented');
  }

  async unsafeRealLogic(x: number): Promise<number> {
    await this.createDecision({ x }, {}, 'rules-v1');
    return x;
  }

  private async privateHelper(x: number): Promise<number> {
    return x;
  }
}
`.trim(),
      );
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export * from "./fixture";');
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does not flag a method that calls enforcePermission', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      const flaggedNames = report.findings.map((f) => f.methodName);
      expect(flaggedNames).not.toContain('safeMethod');
    });

    it('correctly handles a default parameter value containing braces (the bug this scanner had to fix)', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      const flaggedNames = report.findings.map((f) => f.methodName);
      expect(flaggedNames).not.toContain('methodWithTrickyDefaultParam');
    });

    it('flags an honest stub as informational', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      const finding = report.findings.find((f) => f.methodName === 'unsafeStub');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('informational');
    });

    it('flags unguarded real logic as needs_review', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      const finding = report.findings.find((f) => f.methodName === 'unsafeRealLogic');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('needs_review');
    });

    it('never flags a private method', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      const flaggedNames = report.findings.map((f) => f.methodName);
      expect(flaggedNames).not.toContain('privateHelper');
    });

    it('excludes index.ts from the scan', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(tmpDir);

      expect(report.filesScanned).toBe(1);
    });
  });

  describe('scanBotDirectory — real defense bot roster', () => {
    it('finds the known real findings with correct classification', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(REAL_BOTS_DIR);

      const byName = Object.fromEntries(report.findings.map((f) => [f.methodName, f.severity]));

      expect(byName['notifyResponders']).toBe('informational');
      expect(byName['monitorLiveMetric']).toBe('informational');
      expect(byName['ingest']).toBe('needs_review');
      expect(byName['checkCorrelation']).toBe('needs_review');
    });

    it('does not flag known-safe methods', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const report = await bot.scanBotDirectory(REAL_BOTS_DIR);

      const flaggedNames = report.findings.map((f) => f.methodName);
      expect(flaggedNames).not.toContain('scanDirectory');
      expect(flaggedNames).not.toContain('monitorAgent');
      expect(flaggedNames).not.toContain('recordRefusal');
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.scanBotDirectory(REAL_BOTS_DIR);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus when a needs_review finding exists', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec());
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.scanBotDirectory(REAL_BOTS_DIR);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks scanning without redteam:scan-audit-coverage permission', async () => {
      const bot = new AuditBlindSpotterBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanBotDirectory(REAL_BOTS_DIR)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
