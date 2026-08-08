import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ScholarBot, checkStructure, ScholarlyDocument } from '../employees/scholar';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-29',
    role: 'Test Scholar used to verify real structural completeness checking.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Scholar used to verify real section/word-count checks.',
    permissionScope: ['read:document-text'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const GOOD_ABSTRACT = Array(120).fill('word').join(' ');

function completeDoc(overrides: Partial<ScholarlyDocument> = {}): ScholarlyDocument {
  return {
    abstract: GOOD_ABSTRACT,
    introduction: 'x',
    mainBody: 'x',
    conclusion: 'x',
    references: 'x',
    falsifiabilityStatement: 'x',
    ...overrides,
  };
}

describe('checkStructure (pure real completeness check)', () => {
  it('confirms a genuinely complete document', () => {
    const result = checkStructure(completeDoc());
    expect(result.complete).toBe(true);
  });

  it('flags real missing sections', () => {
    const result = checkStructure({ abstract: GOOD_ABSTRACT, introduction: 'x' });
    expect(result.missing).toEqual(
      expect.arrayContaining(['mainBody', 'conclusion', 'references', 'falsifiabilityStatement']),
    );
  });

  it('flags a genuinely too-short abstract', () => {
    const result = checkStructure(completeDoc({ abstract: 'way too short' }));
    expect(result.abstractInRange).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('flags a genuinely too-long abstract', () => {
    const tooLong = Array(200).fill('word').join(' ');
    const result = checkStructure(completeDoc({ abstract: tooLong }));
    expect(result.abstractInRange).toBe(false);
  });
});

describe('ScholarBot', () => {
  describe('reviewDocument', () => {
    it('confirms a real, complete document', async () => {
      const bot = new ScholarBot(makeSpec());
      const result = await bot.reviewDocument(completeDoc());
      expect(result.complete).toBe(true);
    });

    it('signals the swarm on a real incomplete document', async () => {
      const bot = new ScholarBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.reviewDocument({ abstract: GOOD_ABSTRACT });

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks review without read:document-text permission', async () => {
      const bot = new ScholarBot(makeSpec({ permissionScope: [] }));
      await expect(bot.reviewDocument(completeDoc())).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
