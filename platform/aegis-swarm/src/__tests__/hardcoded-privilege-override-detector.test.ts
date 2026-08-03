import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { HardcodedPrivilegeOverrideDetectorBot } from '../bots/hardcoded-privilege-override-detector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-26',
    role: 'Test hardcoded privilege override detector.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only hardcoded privilege override detector used to verify individual-ID overrides are caught while normal role checks are not.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const FAKE_UUID = '11111111-1111-1111-1111-111111111111';

describe('HardcodedPrivilegeOverrideDetectorBot', () => {
  describe('scanFileContent (pure pattern matching)', () => {
    it('flags tenantId hardcoded-compared to a specific UUID', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        `if (tenantId === '${FAKE_UUID}') { return true; }`,
        'middleware/auth.ts',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0].sev).toBe('crit');
    });

    it('flags userId hardcoded-compared to a specific email', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "if (userId === 'founder@ruthlesstech.example') { skipChecks(); }",
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(1);
    });

    it('flags reversed comparison order (literal first)', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        `if ('${FAKE_UUID}' === tenantId) { return true; }`,
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(1);
    });

    it('flags .includes() form against a hardcoded UUID', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        `if (userId.includes('${FAKE_UUID}')) { grantAccess(); }`,
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(1);
    });

    it('does NOT flag a normal role-name comparison', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "if (role === 'admin') { return true; }",
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(0);
    });

    it('does NOT flag a permission-scope comparison', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "if (permission === 'write:orders') { return true; }",
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(0);
    });

    it('does NOT flag an env-configured system tenant constant', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        "const SYSTEM_TENANT_ID = process.env.AEGIS_SYSTEM_TENANT_ID || 'system';",
        'bot-runtime/crystal-bot.ts',
      );
      expect(findings).toHaveLength(0);
    });

    it('does not flag a commented-out example of the bad pattern', () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const findings = bot.scanFileContent(
        `// bad: if (tenantId === '${FAKE_UUID}') return true;`,
        'middleware/auth.ts',
      );
      expect(findings).toHaveLength(0);
    });
  });

  describe('scanDirectory (real filesystem)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-override-test-'));
      fs.writeFileSync(
        path.join(tmpDir, 'vulnerable.ts'),
        `if (tenantId === '${FAKE_UUID}') { return true; }`,
      );
      fs.writeFileSync(path.join(tmpDir, 'safe.ts'), "if (role === 'admin') { return true; }");
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(
        path.join(tmpDir, 'node_modules', 'ignored.ts'),
        `if (tenantId === '${FAKE_UUID}') { return true; }`,
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scans real files and skips node_modules', async () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const report = await bot.scanDirectory(tmpDir);

      expect(report.overridesFound).toBe(1);
      expect(report.filesScanned).toBe(2);
    });

    it('blocks scanning without read:filesystem permission', async () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanDirectory(tmpDir)).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when an override is found', async () => {
      const bot = new HardcodedPrivilegeOverrideDetectorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.scanDirectory(tmpDir);

      expect(received).toHaveLength(1);
      unsubscribe();
    });
  });
});
