import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { PersonaManagerBot, validatePersonas, walkJsonFiles } from '../employees/persona-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-15',
    role: 'Test Persona Manager used to verify real library integrity checks.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Persona Manager used to verify field-completeness and duplicate detection.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_PERSONAS_DIR = path.join(__dirname, '..', '..', '..', '..', 'config', 'personas', 'trades', 'craftbots');

describe('validatePersonas against the real persona library', () => {
  it('finds zero false positives across 50 real, already-good persona files', () => {
    const files = walkJsonFiles(REAL_PERSONAS_DIR).slice(0, 50);
    const result = validatePersonas(files);

    expect(result.totalChecked).toBe(50);
    expect(result.missingFieldReports).toHaveLength(0);
    expect(result.duplicateIds).toHaveLength(0);
  });
});

describe('validatePersonas (synthetic duplicate case)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-dup-'));
    const original = {
      persona_id: 'test_persona_001',
      name: 'Test Persona',
      worldview: 'x',
      behavior: 'x',
      boundaries: 'x',
      humanity_mode: 'x',
    };
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify(original));
    fs.writeFileSync(path.join(tmpDir, 'b.json'), JSON.stringify(original));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a real duplicate persona_id across two files', () => {
    const files = walkJsonFiles(tmpDir);
    const result = validatePersonas(files);
    expect(result.duplicateIds).toHaveLength(1);
    expect(result.duplicateIds[0].id).toBe('test_persona_001');
  });

  it('flags a real missing required field', () => {
    const incomplete = { persona_id: 'incomplete_001', name: 'Incomplete' };
    fs.writeFileSync(path.join(tmpDir, 'c.json'), JSON.stringify(incomplete));
    const result = validatePersonas(walkJsonFiles(tmpDir));
    const report = result.missingFieldReports.find((r) => r.file.endsWith('c.json'));
    expect(report).toBeDefined();
    expect(report!.missing).toContain('worldview');
  });
});

describe('PersonaManagerBot', () => {
  describe('auditLibrary', () => {
    it('produces a real, accurate audit of the real library subset', async () => {
      const bot = new PersonaManagerBot(makeSpec());
      const report = await bot.auditLibrary(REAL_PERSONAS_DIR);

      expect(report.totalChecked).toBeGreaterThan(0);
      expect(report.missingFieldReports).toHaveLength(0);
    });

    it('blocks auditing without read:filesystem permission', async () => {
      const bot = new PersonaManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.auditLibrary(REAL_PERSONAS_DIR)).rejects.toThrow('outside its declared permissionScope');
    });

    it('does not signal the swarm when the real library subset is clean', async () => {
      const bot = new PersonaManagerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.auditLibrary(REAL_PERSONAS_DIR);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });
});
