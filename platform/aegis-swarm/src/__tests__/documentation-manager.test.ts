import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  DocumentationManagerBot,
  verifyFileReference,
  verifyContentReference,
  assessStaleness,
  DocClaim,
} from '../employees/documentation-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-04',
    role: 'Test Documentation Manager used to verify real reference checking and staleness assessment.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Documentation Manager used to verify real filesystem checks.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

describe('verifyFileReference / verifyContentReference (against a synthetic fixture)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-fixture-'));
    fs.writeFileSync(path.join(tmpDir, 'real-file.ts'), 'export function realFunction() { return 1; }');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('confirms a real file reference exists', () => {
    expect(verifyFileReference('real-file.ts', tmpDir)).toBe(true);
  });

  it('confirms a fake file reference does not exist', () => {
    expect(verifyFileReference('fake-file.ts', tmpDir)).toBe(false);
  });

  it('confirms a real content reference is found', () => {
    expect(verifyContentReference('realFunction', tmpDir)).toBe(true);
  });

  it('confirms a fake content reference is not found', () => {
    expect(verifyContentReference('functionThatDoesNotExist12345', tmpDir)).toBe(false);
  });
});

describe('verifyFileReference / verifyContentReference (against the real live repo)', () => {
  it('confirms a real file built tonight actually exists', () => {
    expect(verifyFileReference('platform/aegis-swarm/src/employees/chief-of-staff.ts', REAL_REPO_ROOT)).toBe(true);
  });

  it('confirms a nonexistent file is correctly reported as missing', () => {
    expect(verifyFileReference('platform/aegis-swarm/src/employees/nonexistent-bot.ts', REAL_REPO_ROOT)).toBe(false);
  });

  it('confirms a real function name built tonight is actually findable', () => {
    expect(verifyContentReference('classifyProject', REAL_REPO_ROOT)).toBe(true);
  });
});

describe('assessStaleness (pure Ranganathan "growing organism" logic)', () => {
  it('flags a doc as stale when the code changed more recently than the doc', () => {
    expect(assessStaleness(30, 2)).toBe(true);
  });

  it('does not flag a doc as stale when it was updated after the code', () => {
    expect(assessStaleness(2, 30)).toBe(false);
  });

  it('does not flag a doc as stale when updated the same day as the code', () => {
    expect(assessStaleness(5, 5)).toBe(false);
  });
});

describe('DocumentationManagerBot', () => {
  describe('checkDocHealth', () => {
    it('reports a perfect health score when every claim verifies', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const claims: DocClaim[] = [
        { type: 'file_reference', value: 'platform/aegis-swarm/src/employees/chief-of-staff.ts' },
        { type: 'content_reference', value: 'classifyProject' },
      ];

      const report = await bot.checkDocHealth('some-doc.md', claims, REAL_REPO_ROOT, 1, 30);

      expect(report.healthScore).toBe(100);
      expect(report.brokenClaims).toHaveLength(0);
    });

    it('reports broken claims and a reduced health score for a nonexistent reference', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const claims: DocClaim[] = [
        { type: 'file_reference', value: 'platform/aegis-swarm/src/employees/chief-of-staff.ts' },
        { type: 'file_reference', value: 'platform/aegis-swarm/src/employees/nonexistent-bot.ts' },
      ];

      const report = await bot.checkDocHealth('some-doc.md', claims, REAL_REPO_ROOT, 1, 30);

      expect(report.brokenClaims).toHaveLength(1);
      expect(report.healthScore).toBe(50);
    });

    it('reports a perfect health score of 100 when there are no claims at all', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const report = await bot.checkDocHealth('empty-doc.md', [], REAL_REPO_ROOT, 1, 30);

      expect(report.healthScore).toBe(100);
    });

    it('flags staleness independently of whether claims are broken', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const claims: DocClaim[] = [
        { type: 'file_reference', value: 'platform/aegis-swarm/src/employees/chief-of-staff.ts' },
      ];

      const report = await bot.checkDocHealth('some-doc.md', claims, REAL_REPO_ROOT, 30, 2);

      expect(report.brokenClaims).toHaveLength(0);
      expect(report.stale).toBe(true);
    });

    it('signals the swarm when an issue is found', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkDocHealth(
        'some-doc.md',
        [{ type: 'file_reference', value: 'nonexistent.ts' }],
        REAL_REPO_ROOT,
        1,
        1,
      );

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when everything is healthy and current', async () => {
      const bot = new DocumentationManagerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkDocHealth(
        'some-doc.md',
        [{ type: 'file_reference', value: 'platform/aegis-swarm/src/employees/chief-of-staff.ts' }],
        REAL_REPO_ROOT,
        1,
        30,
      );

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks the check without read:filesystem permission', async () => {
      const bot = new DocumentationManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.checkDocHealth('doc.md', [], REAL_REPO_ROOT, 1, 1)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
