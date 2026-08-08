import { BotSpecification } from '@platform/bot-registry';
import { ContainmentUnitBot, isContained, contain, release, ContainmentRecord } from '../employees/containment-unit';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-32',
    role: 'Test Containment Unit used to verify real scope-aware kill-switch logic.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Containment Unit used to verify real containment state.',
    permissionScope: ['write:containment', 'read:containment'],
    hitlClassification: 'Synchronous Gate',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('isContained / contain / release (pure real state machine)', () => {
  it('confirms a real contained tenant is detected', () => {
    const registry: ContainmentRecord[] = [
      { scope: 'tenant', targetId: 'tenant-A', status: 'contained', reason: 'suspected breach', containedAtMs: 1000 },
    ];
    expect(isContained(registry, 'tenant', 'tenant-A')).toBe(true);
  });

  it('confirms a different tenant is genuinely not contained', () => {
    const registry: ContainmentRecord[] = [
      { scope: 'tenant', targetId: 'tenant-A', status: 'contained', reason: 'x', containedAtMs: 1000 },
    ];
    expect(isContained(registry, 'tenant', 'tenant-B')).toBe(false);
  });

  it('correctly treats the same ID under a different scope as unrelated', () => {
    const registry: ContainmentRecord[] = [
      { scope: 'tenant', targetId: 'shared-id', status: 'contained', reason: 'x', containedAtMs: 1000 },
    ];
    expect(isContained(registry, 'feature', 'shared-id')).toBe(false);
  });

  it('real contain() adds a genuinely contained record', () => {
    const registry = contain([], 'tenant', 'tenant-A', 'test reason', 1000);
    expect(isContained(registry, 'tenant', 'tenant-A')).toBe(true);
  });

  it('real release() genuinely reverses containment', () => {
    let registry = contain([], 'tenant', 'tenant-A', 'test reason', 1000);
    registry = release(registry, 'tenant', 'tenant-A');
    expect(isContained(registry, 'tenant', 'tenant-A')).toBe(false);
  });
});

describe('ContainmentUnitBot', () => {
  describe('containTarget / checkContainment / releaseTarget', () => {
    it('performs a real full contain -> check -> release cycle', async () => {
      const bot = new ContainmentUnitBot(makeSpec());

      await bot.containTarget('tenant', 'tenant-A', 'suspected cross-tenant access');
      expect(await bot.checkContainment('tenant', 'tenant-A')).toBe(true);

      await bot.releaseTarget('tenant', 'tenant-A');
      expect(await bot.checkContainment('tenant', 'tenant-A')).toBe(false);
    });

    it('blocks containment actions without write:containment permission', async () => {
      const bot = new ContainmentUnitBot(makeSpec({ permissionScope: ['read:containment'] }));
      await expect(bot.containTarget('tenant', 'tenant-A', 'x')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
