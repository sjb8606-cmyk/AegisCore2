import { BotSpecification } from '@platform/bot-registry';
import { CopywrightCouncilBot, parseMix, resolvePreset, CopyBrief } from '../employees/copywright-council';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-03',
    role: 'Test Copywright Council used to verify mix/preset parsing and validation.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Copywright Council used to verify parsing, presets, and brief validation.',
    permissionScope: ['generate:copy-brief'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function brief(overrides: Partial<CopyBrief> = {}): CopyBrief {
  return {
    project: 'Pet Planner AI',
    audience: ['busy pet owners', 'multi-pet families'],
    voice: ['warm', 'trustworthy'],
    goal: 'Encourage sign-ups for the free app',
    style: 'modern web copy with empathy and rhythm',
    seoKeywords: ['pet planner', 'vet reminders'],
    pageType: 'home',
    brandStory: 'A calm, intelligent helper for loving, overworked pet owners.',
    ...overrides,
  };
}

describe('parseMix (pure parsing logic)', () => {
  it('parses an equal-weight three-way mix summing to exactly 100', () => {
    const result = parseMix('ogilvy+hemingway+campbell');
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });

  it('parses an explicit weighted mix', () => {
    const result = parseMix('ogilvy:50 hemingway:30 campbell:20');
    expect(result.valid).toBe(true);
    expect(result.weights).toEqual({ ogilvy: 50, hemingway: 30, campbell: 20 });
  });

  it('rejects an unknown master name', () => {
    const result = parseMix('ogilvy:50 shakespeare:50');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects weights that do not sum to 100', () => {
    const result = parseMix('ogilvy:50 hemingway:20');
    expect(result.valid).toBe(false);
    expect(result.total).toBe(70);
  });

  it('handles an odd two-way equal split summing to exactly 100', () => {
    const result = parseMix('hemingway+musashi');
    expect(result.valid).toBe(true);
    expect(result.total).toBe(100);
  });
});

describe('resolvePreset (pure preset lookup)', () => {
  it('resolves a known preset to its real weighted blend', () => {
    const weights = resolvePreset('Heroic Clarity');
    expect(weights).toEqual({ ogilvy: 40, campbell: 40, hemingway: 20 });
  });

  it('returns null for an unknown preset rather than guessing', () => {
    const weights = resolvePreset('Not A Real Preset');
    expect(weights).toBeNull();
  });
});

describe('CopywrightCouncilBot', () => {
  describe('requestMix', () => {
    it('assembles a real prompt with the correct active voices for a valid mix', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestMix(brief(), 'ogilvy:50 hemingway:30 campbell:20');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.assembledPrompt).toContain('Ogilvy (50%)');
        expect(result.assembledPrompt).toContain('Pet Planner AI');
      }
    });

    it('flags a vague brief before even checking the mix', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestMix(brief({ project: '' }), 'ogilvy:100');

      expect(result.status).toBe('clarification_required');
      if (result.status === 'clarification_required') {
        expect(result.missing).toContain('project');
      }
    });

    it('flags an invalid mix on a valid brief', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestMix(brief(), 'ogilvy:50 shakespeare:50');

      expect(result.status).toBe('invalid_mix');
    });

    it('blocks the request without generate:copy-brief permission', async () => {
      const bot = new CopywrightCouncilBot(makeSpec({ permissionScope: [] }));
      await expect(bot.requestMix(brief(), 'ogilvy:100')).rejects.toThrow('outside its declared permissionScope');
    });
  });

  describe('requestPreset', () => {
    it('assembles a real prompt using a known preset', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestPreset(brief(), 'Human Warmth');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.assembledPrompt).toContain('Byron Frankl (50%)');
      }
    });

    it('reports an unknown preset with the real list of available ones', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestPreset(brief(), 'Not A Real Preset');

      expect(result.status).toBe('unknown_preset');
      if (result.status === 'unknown_preset') {
        expect(result.availablePresets).toContain('Heroic Clarity');
      }
    });

    it('flags a vague brief before checking the preset', async () => {
      const bot = new CopywrightCouncilBot(makeSpec());
      const result = await bot.requestPreset(brief({ goal: '' }), 'Heroic Clarity');

      expect(result.status).toBe('clarification_required');
    });
  });
});
