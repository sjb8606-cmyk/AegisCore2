import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ProviderRouterBot, isRetryable, selectNextProvider } from '../employees/provider-router';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-38',
    role: 'Test Provider Router used to verify real retry/fallback logic.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Provider Router used to verify real error classification and fallback.',
    permissionScope: ['write:ai-generation-request'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('isRetryable / selectNextProvider (pure real logic)', () => {
  it('classifies a real rate limit as retryable', () => {
    expect(isRetryable('RATE_LIMITED')).toBe(true);
  });

  it('classifies a real bad request as not retryable', () => {
    expect(isRetryable('BAD_REQUEST')).toBe(false);
  });

  it('selects the real next untried provider', () => {
    expect(selectNextProvider(['groq'], ['groq', 'anthropic', 'openai'])).toBe('anthropic');
  });

  it('returns null when providers are genuinely exhausted', () => {
    expect(selectNextProvider(['groq', 'anthropic', 'openai'], ['groq', 'anthropic', 'openai'])).toBeNull();
  });
});

describe('ProviderRouterBot', () => {
  describe('routeWithFallback', () => {
    it('succeeds on the real first provider when it works', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      const result = await bot.routeWithFallback(['groq', 'anthropic'], async () => ({ ok: true }));

      expect(result.finalProvider).toBe('groq');
      expect(result.attempts).toHaveLength(1);
    });

    it('falls back to a real second provider after a genuine rate limit', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      let callCount = 0;
      const result = await bot.routeWithFallback(['groq', 'anthropic'], async () => {
        callCount++;
        if (callCount === 1) return { ok: false, errorCode: 'RATE_LIMITED' };
        return { ok: true };
      });

      expect(result.finalProvider).toBe('anthropic');
      expect(result.attempts).toHaveLength(2);
    });

    it('stops immediately on a real terminal error, does not waste a retry', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      const result = await bot.routeWithFallback(['groq', 'anthropic'], async () => ({
        ok: false,
        errorCode: 'BAD_REQUEST',
      }));

      expect(result.exhausted).toBe(true);
      expect(result.attempts).toHaveLength(1);
    });

    it('reports genuinely exhausted when every provider fails with a retryable error', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      const result = await bot.routeWithFallback(['groq', 'anthropic'], async () => ({
        ok: false,
        errorCode: 'RATE_LIMITED',
      }));

      expect(result.exhausted).toBe(true);
      expect(result.attempts).toHaveLength(2);
    });

    it('signals the swarm when real providers are genuinely exhausted', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.routeWithFallback(['groq'], async () => ({ ok: false, errorCode: 'RATE_LIMITED' }));

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when a real provider succeeds', async () => {
      const bot = new ProviderRouterBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.routeWithFallback(['groq'], async () => ({ ok: true }));

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks routing without write:ai-generation-request permission', async () => {
      const bot = new ProviderRouterBot(makeSpec({ permissionScope: [] }));
      await expect(bot.routeWithFallback(['groq'], async () => ({ ok: true }))).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
