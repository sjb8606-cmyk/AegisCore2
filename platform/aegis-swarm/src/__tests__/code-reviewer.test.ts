import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { CodeReviewerBot, scanFileContent } from '../employees/code-reviewer';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-07',
    role: 'Test Code Reviewer used to verify real static scanning.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Code Reviewer used to verify real pattern detection.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const CLEAN_CONTENT = `
export class CleanBot {
  async doThing(x: number): Promise<number> {
    return x * 2;
  }
}
`.trim();

const MESSY_CONTENT = `
export class MessyBot {
  async doThing(x: number): Promise<number> {
    // TODO: handle the edge case here
    console.log('debugging', x);
    return x;
  }

  async reallyLongFunction(): Promise<void> {
${Array(65).fill('    const y = 1;').join('\n')}
  }
}
`.trim();

describe('scanFileContent (pure static scanning)', () => {
  it('finds zero issues in genuinely clean code', () => {
    const findings = scanFileContent('clean.ts', CLEAN_CONTENT);
    expect(findings).toHaveLength(0);
  });

  it('catches a real TODO marker', () => {
    const findings = scanFileContent('messy.ts', MESSY_CONTENT);
    expect(findings.some((f) => f.type === 'unfinished_marker')).toBe(true);
  });

  it('catches a real leftover console.log', () => {
    const findings = scanFileContent('messy.ts', MESSY_CONTENT);
    expect(findings.some((f) => f.type === 'console_log_left_in')).toBe(true);
  });

  it('catches a real overly-long function', () => {
    const findings = scanFileContent('messy.ts', MESSY_CONTENT);
    const longFuncFinding = findings.find((f) => f.type === 'long_function');
    expect(longFuncFinding).toBeDefined();
    expect(longFuncFinding!.detail).toContain('reallyLongFunction');
  });

  it('finds all three known planted issues, no more, no fewer', () => {
    const findings = scanFileContent('messy.ts', MESSY_CONTENT);
    expect(findings).toHaveLength(3);
  });
});

describe('CodeReviewerBot', () => {
  describe('reviewDirectory', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-fixture-'));
      fs.writeFileSync(path.join(tmpDir, 'clean.ts'), CLEAN_CONTENT);
      fs.writeFileSync(path.join(tmpDir, 'messy.ts'), MESSY_CONTENT);
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('scans real files and reports findings only from the messy one', async () => {
      const bot = new CodeReviewerBot(makeSpec());
      const report = await bot.reviewDirectory(tmpDir);

      expect(report.filesScanned).toBe(2);
      expect(report.findings.every((f) => f.file === 'messy.ts')).toBe(true);
      expect(report.findings).toHaveLength(3);
    });

    it('signals the swarm when findings exist', async () => {
      const bot = new CodeReviewerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.reviewDirectory(tmpDir);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when a directory has no findings at all', async () => {
      const cleanOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-only-'));
      fs.writeFileSync(path.join(cleanOnlyDir, 'clean.ts'), CLEAN_CONTENT);

      const bot = new CodeReviewerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.reviewDirectory(cleanOnlyDir);

      expect(received).toHaveLength(0);
      unsubscribe();
      fs.rmSync(cleanOnlyDir, { recursive: true, force: true });
    });

    it('blocks reviewing without read:filesystem permission', async () => {
      const bot = new CodeReviewerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.reviewDirectory(tmpDir)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
