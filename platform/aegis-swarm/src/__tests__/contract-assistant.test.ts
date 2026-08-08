import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ContractAssistantBot, checkClauses, RequiredClause } from '../employees/contract-assistant';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-13',
    role: 'Test Contract Assistant used to verify clause-presence checking.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Contract Assistant used to verify real pattern matching.',
    permissionScope: ['read:contract-text'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REQUIRED: RequiredClause[] = [
  { name: 'Termination', patterns: ['termination', 'terminate this agreement'] },
  { name: 'Liability Limitation', patterns: ['limitation of liability', 'limit of liability'] },
  { name: 'Payment Terms', patterns: ['payment terms', 'net 30', 'invoice'] },
];

const FULL_CONTRACT =
  'This agreement includes termination rights, a limitation of liability clause, and payment terms of net 30.';
const INCOMPLETE_CONTRACT = 'This agreement includes termination rights and payment terms.';

describe('checkClauses (pure pattern matching)', () => {
  it('finds all clauses present in a complete contract', () => {
    const results = checkClauses(FULL_CONTRACT, REQUIRED);
    expect(results.every((r) => r.found)).toBe(true);
  });

  it('correctly flags a genuinely missing clause', () => {
    const results = checkClauses(INCOMPLETE_CONTRACT, REQUIRED);
    const liability = results.find((r) => r.clause === 'Liability Limitation');
    expect(liability?.found).toBe(false);
  });
});

describe('ContractAssistantBot', () => {
  describe('reviewContract', () => {
    it('reports complete when every clause is present', async () => {
      const bot = new ContractAssistantBot(makeSpec());
      const report = await bot.reviewContract(FULL_CONTRACT, REQUIRED);
      expect(report.complete).toBe(true);
      expect(report.missingClauses).toHaveLength(0);
    });

    it('reports the real missing clause by name', async () => {
      const bot = new ContractAssistantBot(makeSpec());
      const report = await bot.reviewContract(INCOMPLETE_CONTRACT, REQUIRED);
      expect(report.complete).toBe(false);
      expect(report.missingClauses).toEqual(['Liability Limitation']);
    });

    it('signals the swarm when a clause is missing', async () => {
      const bot = new ContractAssistantBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.reviewContract(INCOMPLETE_CONTRACT, REQUIRED);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks review without read:contract-text permission', async () => {
      const bot = new ContractAssistantBot(makeSpec({ permissionScope: [] }));
      await expect(bot.reviewContract(FULL_CONTRACT, REQUIRED)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
