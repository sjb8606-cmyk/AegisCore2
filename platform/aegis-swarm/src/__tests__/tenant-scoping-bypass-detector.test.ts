import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { TenantScopingBypassDetectorBot } from '../bots/tenant-scoping-bypass-detector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-25',
    role: 'Test tenant scoping bypass detector used to verify pattern matching.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only tenant scoping bypass detector used to verify the raw-header pattern is caught and the verified-context pattern is not.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('TenantScopingBypassDetectorBot', () => {
  describe('scanFileContent (pure pattern matching)', () => {
    it('flags tenantId read from a raw x-tenant-id header (bracket form)', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "const tenantId = req.headers['x-tenant-id'];",
        'routes/orders.ts',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].sev).toBe('block');
      expect(findings[0].desc).toContain('x-tenant-id');
    });

    it('flags userId read from a raw x-user-id header (double-quote form)', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        'const userId = req.headers["x-user-id"];',
        'routes/profile.ts',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].desc).toContain('x-user-id');
    });

    it('flags the .header() call form', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "const tenantId = req.header('x-tenant-id');",
        'routes/billing.ts',
      );
      expect(findings).toHaveLength(1);
    });

    it('does NOT flag the correct, JWT-verified pattern', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        'const tenantId = req.auth?.tenantId;',
        'routes/orders.ts',
      );
      expect(findings).toHaveLength(0);
    });

    it('does not flag a commented-out example of the bad pattern', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "// Do NOT do this: const tenantId = req.headers['x-tenant-id'];",
        'routes/orders.ts',
      );
      expect(findings).toHaveLength(0);
    });

    it('reports the correct line number', () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const content = [
        'function handler(req, res) {',
        "  const tenantId = req.headers['x-tenant-id'];",
        '}',
      ].join('\n');
      const findings = bot.scanFileContent(content, 'orders.ts');
      expect(findings[0].loc).toBe('orders.ts:2');
    });
  });

  describe('scanDirectory (real filesystem)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-scoping-test-'));
      fs.writeFileSync(
        path.join(tmpDir, 'vulnerable.ts'),
        "const tenantId = req.headers['x-tenant-id'];",
      );
      fs.writeFileSync(path.join(tmpDir, 'safe.ts'), 'const tenantId = req.auth?.tenantId;');
      fs.writeFileSync(
        path.join(tmpDir, 'fixture.json'),
        JSON.stringify({ example: "req.headers['x-tenant-id']" }),
      );
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(
        path.join(tmpDir, 'node_modules', 'ignored.ts'),
        "const tenantId = req.headers['x-tenant-id'];",
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scans real files, skips node_modules and non-code files', async () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const report = await bot.scanDirectory(tmpDir);

      expect(report.bypassesFound).toBe(1);
      expect(report.filesScanned).toBe(2);
    });

    it('blocks scanning without read:filesystem permission', async () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanDirectory(tmpDir)).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when a bypass is found', async () => {
      const bot = new TenantScopingBypassDetectorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.scanDirectory(tmpDir);

      expect(received).toHaveLength(1);
      unsubscribe();
    });
  });
});
