import * as path from 'path';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  FactoryManagerBot,
  validateSpecCompleteness,
  checkIdCollision,
  loadExistingBotIds,
  ProposedSpec,
} from '../employees/factory-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-16',
    role: 'Test Factory Manager used to verify spec completeness and ID collision checks.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Factory Manager used to verify real spec review logic.',
    permissionScope: ['read:bot-registry'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_BOTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'config', 'bots');

function proposedSpec(overrides: Partial<ProposedSpec> = {}): ProposedSpec {
  return {
    proposedBotId: 'E-99',
    role: 'A real test role',
    permissionScope: ['read:test'],
    hitlClassification: 'Logging',
    hardStops: ['never do the bad thing'],
    behaviorDescription: 'Does a real thing.',
    ...overrides,
  };
}

describe('validateSpecCompleteness (pure)', () => {
  it('confirms a genuinely complete spec', () => {
    expect(validateSpecCompleteness(proposedSpec()).complete).toBe(true);
  });

  it('flags every missing field on an incomplete spec', () => {
    const result = validateSpecCompleteness(
      proposedSpec({ role: '', permissionScope: [], hitlClassification: 'Invalid', hardStops: [], behaviorDescription: '' }),
    );
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(['role', 'permissionScope', 'hitlClassification', 'hardStops', 'behaviorDescription']),
    );
  });
});

describe('checkIdCollision (pure)', () => {
  it('detects a real collision', () => {
    expect(checkIdCollision('E-01', ['E-01', 'E-02'])).toBe(true);
  });

  it('confirms no collision for a genuinely new ID', () => {
    expect(checkIdCollision('E-99', ['E-01', 'E-02'])).toBe(false);
  });
});

describe('loadExistingBotIds against the real live roster', () => {
  it('loads real IDs from the actual config/bots directory', () => {
    const ids = loadExistingBotIds(REAL_BOTS_DIR);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('E-01');
  });
});

describe('FactoryManagerBot', () => {
  describe('reviewProposedSpec', () => {
    it('approves a genuinely complete spec with no real collision', async () => {
      const bot = new FactoryManagerBot(makeSpec());
      const review = await bot.reviewProposedSpec(proposedSpec({ proposedBotId: 'E-999' }), REAL_BOTS_DIR);

      expect(review.approved).toBe(true);
      expect(review.idCollision).toBe(false);
    });

    it('rejects a spec whose ID genuinely collides with the real live roster', async () => {
      const bot = new FactoryManagerBot(makeSpec());
      const review = await bot.reviewProposedSpec(proposedSpec({ proposedBotId: 'E-01' }), REAL_BOTS_DIR);

      expect(review.approved).toBe(false);
      expect(review.idCollision).toBe(true);
    });

    it('rejects an incomplete spec even with no ID collision', async () => {
      const bot = new FactoryManagerBot(makeSpec());
      const review = await bot.reviewProposedSpec(
        proposedSpec({ proposedBotId: 'E-999', role: '' }),
        REAL_BOTS_DIR,
      );

      expect(review.approved).toBe(false);
      expect(review.completenessCheck.complete).toBe(false);
    });

    it('signals the swarm when a spec is rejected', async () => {
      const bot = new FactoryManagerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.reviewProposedSpec(proposedSpec({ proposedBotId: 'E-01' }), REAL_BOTS_DIR);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks review without read:bot-registry permission', async () => {
      const bot = new FactoryManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.reviewProposedSpec(proposedSpec(), REAL_BOTS_DIR)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
