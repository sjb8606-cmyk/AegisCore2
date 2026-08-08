import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { RDCouncilBot, getDomain, suggestDomains, pairDomains } from '../employees/rd-council';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-08',
    role: 'Test R&D Council used to verify domain switching and cross-domain pairing.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only R&D Council used to verify real domain lookup and synthesis.',
    permissionScope: ['generate:rd-brief'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('getDomain (the real "switch")', () => {
  it('finds a known domain by key', () => {
    expect(getDomain('ancient_technologies')?.name).toBe('Ancient Technologies');
  });

  it('returns null for an unknown domain rather than guessing', () => {
    expect(getDomain('made_up_domain')).toBeNull();
  });

  it('has all 12 real domains registered', () => {
    const allKeys = [
      'physics', 'chemistry', 'biology', 'mathematics', 'materials_science',
      'mechanical_engineering', 'electrical_engineering', 'civil_engineering',
      'computer_science', 'environmental_science', 'ancient_technologies', 'closed_loop_systems',
    ];
    for (const key of allKeys) {
      expect(getDomain(key)).not.toBeNull();
    }
  });
});

describe('suggestDomains (real keyword suggestion)', () => {
  it('suggests Ancient Technologies for a traditional/historical query', () => {
    const suggestions = suggestDomains('a traditional pre-industrial artisan technique');
    expect(suggestions.map((d) => d.key)).toContain('ancient_technologies');
  });

  it('suggests Materials Science for a composite/alloy query', () => {
    const suggestions = suggestDomains('a new composite material with better durability');
    expect(suggestions.map((d) => d.key)).toContain('materials_science');
  });
});

describe('pairDomains (the real "talking to each other" mechanism)', () => {
  it('pairs the exact use case: Ancient Technologies + Materials Science', () => {
    const result = pairDomains(['ancient_technologies', 'materials_science'], 'a new insulation approach');
    expect(result.paired).toBe(true);
    expect(result.domains).toHaveLength(2);
    expect(result.assembledBrief).toContain('Ancient Technologies');
    expect(result.assembledBrief).toContain('Materials Science');
  });

  it('pairs three domains at once', () => {
    const result = pairDomains(['ancient_technologies', 'materials_science', 'chemistry'], 'topic');
    expect(result.paired).toBe(true);
    expect(result.domains).toHaveLength(3);
  });

  it('does not consider a single domain "paired"', () => {
    const result = pairDomains(['ancient_technologies'], 'topic');
    expect(result.paired).toBe(false);
  });

  it('honestly reports an unknown domain key rather than silently dropping it', () => {
    const result = pairDomains(['ancient_technologies', 'made_up_domain'], 'topic');
    expect(result.missingKeys).toEqual(['made_up_domain']);
    expect(result.domains).toHaveLength(1);
  });

  it('includes the real topic in the assembled brief', () => {
    const result = pairDomains(['physics'], 'a self-balancing water wheel');
    expect(result.assembledBrief).toContain('a self-balancing water wheel');
  });
});

describe('RDCouncilBot', () => {
  describe('convene', () => {
    it('produces a real paired result for the stated use case', async () => {
      const bot = new RDCouncilBot(makeSpec());
      const result = await bot.convene(['ancient_technologies', 'materials_science'], 'passive cooling design');

      expect(result.paired).toBe(true);
      expect(result.domains.map((d) => d.key)).toEqual(['ancient_technologies', 'materials_science']);
    });

    it('signals the swarm when an unknown domain is requested', async () => {
      const bot = new RDCouncilBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.convene(['ancient_technologies', 'made_up_domain'], 'topic');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when every requested domain is real', async () => {
      const bot = new RDCouncilBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.convene(['ancient_technologies', 'materials_science'], 'topic');

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks convening without generate:rd-brief permission', async () => {
      const bot = new RDCouncilBot(makeSpec({ permissionScope: [] }));
      await expect(bot.convene(['physics'], 'topic')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
