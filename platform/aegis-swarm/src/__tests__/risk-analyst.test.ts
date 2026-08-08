import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { RiskAnalystBot, scoreRisk, RiskItem } from '../employees/risk-analyst';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-19',
    role: 'Test Risk Analyst used to verify real likelihood x impact scoring.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Risk Analyst used to verify real risk matrix math.',
    permissionScope: ['read:risk-items'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('scoreRisk (pure real risk matrix)', () => {
  it('bands a genuinely low risk correctly', () => {
    expect(scoreRisk({ name: 'x', likelihood: 1, impact: 1 }).band).toBe('low');
  });

  it('bands a genuinely medium risk correctly', () => {
    expect(scoreRisk({ name: 'x', likelihood: 2, impact: 3 }).band).toBe('medium');
  });

  it('bands a genuinely high risk correctly', () => {
    expect(scoreRisk({ name: 'x', likelihood: 4, impact: 3 }).band).toBe('high');
  });

  it('bands a genuinely critical risk correctly', () => {
    expect(scoreRisk({ name: 'x', likelihood: 5, impact: 5 }).band).toBe('critical');
  });

  it('handles the exact boundary score of 20 as critical', () => {
    expect(scoreRisk({ name: 'x', likelihood: 4, impact: 5 }).band).toBe('critical');
  });
});

describe('RiskAnalystBot', () => {
  const ITEMS: RiskItem[] = [
    { name: 'Low item', likelihood: 1, impact: 1 },
    { name: 'Critical item', likelihood: 5, impact: 5 },
  ];

  describe('assessRisks', () => {
    it('produces a real register with correct critical count', async () => {
      const bot = new RiskAnalystBot(makeSpec());
      const register = await bot.assessRisks(ITEMS);

      expect(register.criticalCount).toBe(1);
      expect(register.highestScore?.name).toBe('Critical item');
    });

    it('signals the swarm when a critical risk exists', async () => {
      const bot = new RiskAnalystBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.assessRisks(ITEMS);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when nothing is critical', async () => {
      const bot = new RiskAnalystBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.assessRisks([{ name: 'Low item', likelihood: 1, impact: 1 }]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks assessment without read:risk-items permission', async () => {
      const bot = new RiskAnalystBot(makeSpec({ permissionScope: [] }));
      await expect(bot.assessRisks(ITEMS)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
