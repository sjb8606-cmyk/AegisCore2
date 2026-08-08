import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  InnovationArchitectBot,
  computeBuildOrder,
  identifyCoreComponents,
  TechComponent,
} from '../employees/innovation-architect';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-10',
    role: 'Test Innovation Architect used to verify build ordering and cycle detection.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Innovation Architect used to verify Kahn\'s algorithm and core-component analysis.',
    permissionScope: ['read:technical-components'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('computeBuildOrder (pure Kahn\'s algorithm)', () => {
  it('computes a correct build order for a valid dependency chain', () => {
    const result = computeBuildOrder([
      { id: 'A', description: '', dependsOn: ['B'] },
      { id: 'B', description: '', dependsOn: ['C'] },
      { id: 'C', description: '', dependsOn: [] },
    ]);
    expect(result.hasCycle).toBe(false);
    expect(result.buildOrder).toEqual(['C', 'B', 'A']);
  });

  it('detects a genuine circular dependency and names the components involved', () => {
    const result = computeBuildOrder([
      { id: 'A', description: '', dependsOn: ['B'] },
      { id: 'B', description: '', dependsOn: ['A'] },
    ]);
    expect(result.hasCycle).toBe(true);
    expect(result.buildOrder).toHaveLength(0);
    expect(result.cycleComponents.sort()).toEqual(['A', 'B']);
  });

  it('computes a correct order for a realistic multi-component design', () => {
    const result = computeBuildOrder([
      { id: 'core_mechanism', description: '', dependsOn: [] },
      { id: 'housing', description: '', dependsOn: ['core_mechanism'] },
      { id: 'sensor_layer', description: '', dependsOn: ['core_mechanism'] },
      { id: 'ui_dashboard', description: '', dependsOn: ['sensor_layer', 'housing'] },
    ]);
    expect(result.hasCycle).toBe(false);
    expect(result.buildOrder[0]).toBe('core_mechanism');
    expect(result.buildOrder[result.buildOrder.length - 1]).toBe('ui_dashboard');
  });
});

describe('identifyCoreComponents (pure dependency-graph analysis)', () => {
  it('identifies a genuinely load-bearing component as core', () => {
    const result = identifyCoreComponents([
      { id: 'core_mechanism', description: '', dependsOn: [] },
      { id: 'housing', description: '', dependsOn: ['core_mechanism'] },
    ]);
    expect(result.core).toContain('core_mechanism');
    expect(result.enhancement).toContain('housing');
  });

  it('classifies a component nothing depends on as an enhancement candidate', () => {
    const result = identifyCoreComponents([
      { id: 'core_mechanism', description: '', dependsOn: [] },
      { id: 'optional_ui_skin', description: '', dependsOn: ['core_mechanism'] },
    ]);
    expect(result.enhancement).toContain('optional_ui_skin');
  });
});

describe('InnovationArchitectBot', () => {
  describe('architect', () => {
    const components: TechComponent[] = [
      { id: 'core_mechanism', description: 'the real invention', dependsOn: [] },
      { id: 'housing', description: 'enclosure', dependsOn: ['core_mechanism'] },
      { id: 'sensor_layer', description: 'sensing', dependsOn: ['core_mechanism'] },
    ];

    it('produces a real, complete architecture report', async () => {
      const bot = new InnovationArchitectBot(makeSpec());
      const report = await bot.architect(components);

      expect(report.buildOrder.hasCycle).toBe(false);
      expect(report.buildOrder.buildOrder[0]).toBe('core_mechanism');
      expect(report.coreComponents).toContain('core_mechanism');
    });

    it('signals the swarm when a real circular dependency is found', async () => {
      const bot = new InnovationArchitectBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.architect([
        { id: 'A', description: '', dependsOn: ['B'] },
        { id: 'B', description: '', dependsOn: ['A'] },
      ]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when the design has a valid build order', async () => {
      const bot = new InnovationArchitectBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.architect(components);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks architecting without read:technical-components permission', async () => {
      const bot = new InnovationArchitectBot(makeSpec({ permissionScope: [] }));
      await expect(bot.architect(components)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
