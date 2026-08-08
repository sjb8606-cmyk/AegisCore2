import { BotSpecification } from '@platform/bot-registry';
import {
  MoriBot,
  computeWeeklyTotal,
  computeLongestSession,
  countSessionsOverThreshold,
  WorkSession,
} from '../employees/mori';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-17',
    role: 'Test Mori used to verify real factual session arithmetic.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Mori used to verify real elapsed-time math.',
    permissionScope: ['read:work-sessions'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const HOUR = 3600000;
const SESSIONS: WorkSession[] = [
  { startMs: 0, endMs: 2 * HOUR },
  { startMs: 3 * HOUR, endMs: 9 * HOUR },
];

describe('computeWeeklyTotal (pure real arithmetic)', () => {
  it('sums real hours within a real window correctly', () => {
    expect(computeWeeklyTotal(SESSIONS, 0, 24 * HOUR)).toBe(8);
  });

  it('excludes sessions genuinely outside the window', () => {
    expect(computeWeeklyTotal(SESSIONS, 10 * HOUR, 24 * HOUR)).toBe(0);
  });
});

describe('computeLongestSession (pure)', () => {
  it('finds the real longest session', () => {
    expect(computeLongestSession(SESSIONS)).toBe(6);
  });

  it('returns zero for no sessions', () => {
    expect(computeLongestSession([])).toBe(0);
  });
});

describe('countSessionsOverThreshold (pure)', () => {
  it('counts sessions genuinely at or above a real threshold', () => {
    expect(countSessionsOverThreshold(SESSIONS, 5)).toBe(1);
  });

  it('counts zero when nothing meets the threshold', () => {
    expect(countSessionsOverThreshold(SESSIONS, 10)).toBe(0);
  });
});

describe('MoriBot', () => {
  describe('summarizeSessions', () => {
    it('produces a real, purely factual summary', async () => {
      const bot = new MoriBot(makeSpec());
      const summary = await bot.summarizeSessions(SESSIONS, 0, 24 * HOUR);

      expect(summary.totalHoursInWindow).toBe(8);
      expect(summary.longestSessionHours).toBe(6);
      expect(summary.sessionCount).toBe(2);
    });

    it('blocks summarizing without read:work-sessions permission', async () => {
      const bot = new MoriBot(makeSpec({ permissionScope: [] }));
      await expect(bot.summarizeSessions(SESSIONS, 0, 24 * HOUR)).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
