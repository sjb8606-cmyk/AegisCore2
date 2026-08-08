import { BotSpecification } from '@platform/bot-registry';
import { ProductManagerBot, classifyMoscow, FeatureRequest } from '../employees/product-manager';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-11',
    role: 'Test Product Manager used to verify MoSCoW classification.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Product Manager used to verify real release-scoping logic.',
    permissionScope: ['read:feature-requests'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function feature(overrides: Partial<FeatureRequest> = {}): FeatureRequest {
  return {
    name: 'Test Feature',
    blocksCoreFunction: false,
    legalOrComplianceRequired: false,
    workaroundExists: true,
    explicitlyOutOfScope: false,
    ...overrides,
  };
}

describe('classifyMoscow (pure MoSCoW logic)', () => {
  it('classifies a core-blocking feature as must', () => {
    expect(classifyMoscow(feature({ blocksCoreFunction: true })).category).toBe('must');
  });

  it('classifies a legal requirement as must', () => {
    expect(classifyMoscow(feature({ legalOrComplianceRequired: true })).category).toBe('must');
  });

  it('classifies an important, no-workaround feature as should', () => {
    expect(classifyMoscow(feature({ workaroundExists: false })).category).toBe('should');
  });

  it('classifies a feature with a real workaround as could', () => {
    expect(classifyMoscow(feature({ workaroundExists: true })).category).toBe('could');
  });

  it('explicit out-of-scope wins even over a core-blocking feature', () => {
    expect(classifyMoscow(feature({ blocksCoreFunction: true, explicitlyOutOfScope: true })).category).toBe('wont');
  });
});

describe('ProductManagerBot', () => {
  describe('scopeRelease', () => {
    it('sorts real features into the correct MoSCoW buckets', async () => {
      const bot = new ProductManagerBot(makeSpec());
      const scope = await bot.scopeRelease([
        feature({ name: 'A', blocksCoreFunction: true }),
        feature({ name: 'B', workaroundExists: false }),
        feature({ name: 'C', workaroundExists: true }),
        feature({ name: 'D', explicitlyOutOfScope: true }),
      ]);

      expect(scope.must.map((f) => f.name)).toEqual(['A']);
      expect(scope.should.map((f) => f.name)).toEqual(['B']);
      expect(scope.could.map((f) => f.name)).toEqual(['C']);
      expect(scope.wont.map((f) => f.name)).toEqual(['D']);
    });

    it('blocks scoping without read:feature-requests permission', async () => {
      const bot = new ProductManagerBot(makeSpec({ permissionScope: [] }));
      await expect(bot.scopeRelease([])).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
