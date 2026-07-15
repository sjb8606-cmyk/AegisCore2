import fs from 'fs';
import path from 'path';
import os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { SecretsExposureDetectorBot } from '../bots/secrets-exposure-detector';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-16',
    role: 'Test secrets detector used to verify pattern matching and redaction.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only secrets exposure detector used to verify pattern matching, severity, and that raw secret values never leak into output.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const FAKE_AWS_KEY = 'AKIAABCDEFGHIJKLMNOP';
const FAKE_PASSWORD_VALUE = 'hunter2super';

describe('SecretsExposureDetectorBot', () => {
  describe('scanFileContent (pure pattern matching)', () => {
    it('detects a fake AWS access key as block severity', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const findings = bot.scanFileContent(`const awsKey = "${FAKE_AWS_KEY}";`, 'sample.ts');

      expect(findings).toHaveLength(1);
      expect(findings[0].sev).toBe('block');
      expect(findings[0].desc).toContain('AWS Access Key');
    });

    it('detects a hardcoded password as warn severity', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const findings = bot.scanFileContent(`const password = "${FAKE_PASSWORD_VALUE}";`, 'sample.ts');

      expect(findings).toHaveLength(1);
      expect(findings[0].sev).toBe('warn');
    });

    it('detects a private key header', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const findings = bot.scanFileContent('-----BEGIN RSA PRIVATE KEY-----', 'id_rsa');
      expect(findings).toHaveLength(1);
      expect(findings[0].sev).toBe('block');
    });

    it('finds nothing in clean code', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const findings = bot.scanFileContent('export function add(a: number, b: number) { return a + b; }', 'math.ts');
      expect(findings).toHaveLength(0);
    });

    it('NEVER includes the actual matched secret value in the finding', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const findings = bot.scanFileContent(`const awsKey = "${FAKE_AWS_KEY}";`, 'sample.ts');

      const serialized = JSON.stringify(findings);
      expect(serialized).not.toContain(FAKE_AWS_KEY);
      expect(serialized).toContain('AWS Access Key');
    });

    it('reports the correct line number for a match on a later line', () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const content = ['line one', 'line two', `const key = "${FAKE_AWS_KEY}";`].join('\n');
      const findings = bot.scanFileContent(content, 'sample.ts');

      expect(findings[0].loc).toBe('sample.ts:3');
    });
  });

  describe('scanDirectory (real filesystem)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
      fs.writeFileSync(path.join(tmpDir, 'leaky.ts'), `const awsKey = "${FAKE_AWS_KEY}";`);
      fs.writeFileSync(path.join(tmpDir, 'clean.ts'), 'export const x = 1;');
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(
        path.join(tmpDir, 'node_modules', 'ignored.ts'),
        `const alsoLeaky = "${FAKE_AWS_KEY}";`,
      );
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scans real files and skips excluded directories like node_modules', async () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const report = await bot.scanDirectory(tmpDir);

      // Only leaky.ts should be flagged — node_modules/ignored.ts must be skipped.
      expect(report.secretsFound).toBe(1);
      expect(report.filesScanned).toBe(2); // leaky.ts + clean.ts, not the node_modules file
    });

    it('blocks scanning if the bot lacks read:filesystem permission', async () => {
      const bot = new SecretsExposureDetectorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scanDirectory(tmpDir)).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when a block-severity secret is found', async () => {
      const bot = new SecretsExposureDetectorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.scanDirectory(tmpDir);

      expect(received).toHaveLength(1);
      unsubscribe();
    });
  });
});
