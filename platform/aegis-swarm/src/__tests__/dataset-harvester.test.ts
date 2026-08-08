import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { DatasetHarvesterBot, validateHarvestedClaim, HarvestedClaim } from '../employees/dataset-harvester';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-30',
    role: 'Test Dataset Harvester used to verify real search-log enforcement.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Dataset Harvester used to verify real claim validation.',
    permissionScope: ['write:harvested-claims'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function claim(overrides: Partial<HarvestedClaim> = {}): HarvestedClaim {
  return {
    id: 'claim-1',
    category: 'pqc_algorithm',
    claimedValue: 'ML-KEM-768',
    claimedSource: 'NIST FIPS 203',
    searchLog: [{ strategy: 'filename', query: 'ML-KEM', found: true }],
    ...overrides,
  };
}

describe('validateHarvestedClaim (pure real search-log enforcement)', () => {
  it('accepts a real found claim regardless of search log length', () => {
    expect(validateHarvestedClaim(claim()).valid).toBe(true);
  });

  it('rejects a "not found" claim with only one real search strategy', () => {
    const result = validateHarvestedClaim(
      claim({ claimedValue: null, searchLog: [{ strategy: 'filename', query: 'x', found: false }] }),
    );
    expect(result.valid).toBe(false);
  });

  it('accepts a "not found" claim with a real multi-strategy search log', () => {
    const result = validateHarvestedClaim(
      claim({
        claimedValue: null,
        searchLog: [
          { strategy: 'filename', query: 'x', found: false },
          { strategy: 'content grep', query: 'x', found: false },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });
});

describe('DatasetHarvesterBot', () => {
  describe('submitClaim', () => {
    it('signals the swarm on a real rejected incomplete search', async () => {
      const bot = new DatasetHarvesterBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.submitClaim(claim({ claimedValue: null, searchLog: [{ strategy: 'filename', query: 'x', found: false }] }));

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal on a real, valid claim', async () => {
      const bot = new DatasetHarvesterBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.submitClaim(claim());

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks submission without write:harvested-claims permission', async () => {
      const bot = new DatasetHarvesterBot(makeSpec({ permissionScope: [] }));
      await expect(bot.submitClaim(claim())).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
