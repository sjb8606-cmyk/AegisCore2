import * as path from 'path';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { SystemsArchitectBot, buildPackageGraph, findCycle, PackageGraph } from '../employees/systems-architect';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-14',
    role: 'Test Systems Architect used to verify real package dependency cycle detection.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Systems Architect used to verify real DFS cycle detection.',
    permissionScope: ['read:filesystem'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const REAL_PLATFORM_DIR = path.join(__dirname, '..', '..', '..');

describe('findCycle (pure DFS cycle detection)', () => {
  it('finds no cycle in a genuinely acyclic graph', () => {
    const graph: PackageGraph = { '@platform/a': ['@platform/b'], '@platform/b': ['@platform/c'], '@platform/c': [] };
    expect(findCycle(graph)).toBeNull();
  });

  it('detects a real two-node cycle and names the path', () => {
    const graph: PackageGraph = { '@platform/a': ['@platform/b'], '@platform/b': ['@platform/a'] };
    const cycle = findCycle(graph);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('@platform/a');
    expect(cycle).toContain('@platform/b');
  });
});

describe('buildPackageGraph / findCycle against the real live repo', () => {
  it('finds real packages in the actual platform directory', () => {
    const graph = buildPackageGraph(REAL_PLATFORM_DIR);
    expect(Object.keys(graph).length).toBeGreaterThan(0);
    expect(graph['@platform/aegis-swarm']).toBeDefined();
  });

  it('confirms the real, actual repo has zero circular dependencies', () => {
    const graph = buildPackageGraph(REAL_PLATFORM_DIR);
    expect(findCycle(graph)).toBeNull();
  });
});

describe('SystemsArchitectBot', () => {
  describe('auditArchitecture', () => {
    it('produces a real, accurate audit of the actual repo', async () => {
      const bot = new SystemsArchitectBot(makeSpec());
      const audit = await bot.auditArchitecture(REAL_PLATFORM_DIR);

      expect(audit.packageCount).toBeGreaterThan(0);
      expect(audit.hasCycle).toBe(false);
      expect(audit.cyclePath).toBeNull();
    });

    it('blocks auditing without read:filesystem permission', async () => {
      const bot = new SystemsArchitectBot(makeSpec({ permissionScope: [] }));
      await expect(bot.auditArchitecture(REAL_PLATFORM_DIR)).rejects.toThrow('outside its declared permissionScope');
    });

    it('does not signal the swarm when the real repo has no cycle', async () => {
      const bot = new SystemsArchitectBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.auditArchitecture(REAL_PLATFORM_DIR);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });
});
