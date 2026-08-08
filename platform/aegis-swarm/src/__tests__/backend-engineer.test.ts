import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { BackendEngineerBot, compareEndpoints, ApiEndpoint } from '../employees/backend-engineer';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-20',
    role: 'Test Backend Engineer used to verify real endpoint comparison.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Backend Engineer used to verify real set-difference logic.',
    permissionScope: ['read:api-spec'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const EXPECTED: ApiEndpoint[] = [
  { method: 'GET', path: '/users' },
  { method: 'POST', path: '/users' },
];

describe('compareEndpoints (pure real comparison)', () => {
  it('confirms an exact match has no findings', () => {
    const result = compareEndpoints(EXPECTED, EXPECTED);
    expect(result.matches).toBe(true);
  });

  it('detects a real missing endpoint', () => {
    const result = compareEndpoints(EXPECTED, [{ method: 'GET', path: '/users' }]);
    expect(result.missing).toEqual(['POST /users']);
  });

  it('detects a real, undocumented extra endpoint', () => {
    const result = compareEndpoints(EXPECTED, [...EXPECTED, { method: 'GET', path: '/secret' }]);
    expect(result.extra).toEqual(['GET /secret']);
  });
});

describe('BackendEngineerBot', () => {
  describe('validateContract', () => {
    it('signals the swarm on a real mismatch', async () => {
      const bot = new BackendEngineerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.validateContract(EXPECTED, [{ method: 'GET', path: '/users' }]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal on a real exact match', async () => {
      const bot = new BackendEngineerBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.validateContract(EXPECTED, EXPECTED);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks validation without read:api-spec permission', async () => {
      const bot = new BackendEngineerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.validateContract(EXPECTED, EXPECTED)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
