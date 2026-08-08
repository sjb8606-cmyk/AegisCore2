import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ApiGovernorBot, checkUsage, UsageLimits } from '../employees/api-governor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-26',
    role: 'Test API Governor used to verify real usage-limit enforcement.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only API Governor used to verify real threshold checks.',
    permissionScope: ['read:session-usage'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const LIMITS: UsageLimits = { maxTurns: 50, maxTokens: 100000, maxSessionDurationMs: 3600000 };

describe('checkUsage (pure real threshold enforcement)', () => {
  it('allows a genuinely within-limits session', () => {
    const result = checkUsage({ turnCount: 10, tokenCount: 5000, sessionDurationMs: 60000 }, LIMITS);
    expect(result.allowed).toBe(true);
  });

  it('blocks a session that genuinely hit the turn limit', () => {
    const result = checkUsage({ turnCount: 50, tokenCount: 5000, sessionDurationMs: 60000 }, LIMITS);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('Turn limit');
  });

  it('blocks a session that genuinely hit the token limit', () => {
    const result = checkUsage({ turnCount: 10, tokenCount: 100000, sessionDurationMs: 60000 }, LIMITS);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('Token limit');
  });

  it('reports every real reason when multiple limits are exceeded at once', () => {
    const result = checkUsage({ turnCount: 50, tokenCount: 100000, sessionDurationMs: 60000 }, LIMITS);
    expect(result.reasons).toHaveLength(2);
  });
});

describe('ApiGovernorBot', () => {
  describe('checkSession', () => {
    it('signals the swarm when a real limit is exceeded', async () => {
      const bot = new ApiGovernorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkSession({ turnCount: 50, tokenCount: 5000, sessionDurationMs: 60000 }, LIMITS);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when genuinely within limits', async () => {
      const bot = new ApiGovernorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.checkSession({ turnCount: 10, tokenCount: 5000, sessionDurationMs: 60000 }, LIMITS);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks checking without read:session-usage permission', async () => {
      const bot = new ApiGovernorBot(makeSpec({ permissionScope: [] }));
      await expect(
        bot.checkSession({ turnCount: 1, tokenCount: 1, sessionDurationMs: 1 }, LIMITS),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
