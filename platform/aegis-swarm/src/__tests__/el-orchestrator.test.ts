import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ElOrchestrator, classifyIntent, routeToEmployees } from '../employees/el-orchestrator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'EL-01',
    role: 'Test El orchestrator used to verify intent classification and employee routing.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only El orchestrator used to verify OODA-based routing and honest null classification.',
    permissionScope: ['orchestrate:employee-roster'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('classifyIntent (pure, honest keyword classification)', () => {
  it('classifies a clear problem-shaped request', () => {
    const result = classifyIntent('The build is broken, fix it now');
    expect(result.intent).toBe('problem');
  });

  it('classifies a clear dream-shaped request', () => {
    const result = classifyIntent('What if we built a brand new revenue model, imagine the possibilities');
    expect(result.intent).toBe('dream');
  });

  it('returns null rather than a disguised guess when nothing actually matches', () => {
    const result = classifyIntent('Help me figure out priorities for my messy project list');
    expect(result.intent).toBeNull();
    expect(result.score).toBe(0);
  });
});

describe('routeToEmployees (pure, real roster routing)', () => {
  it('routes a prioritization request to Chief of Staff', () => {
    const routed = routeToEmployees('Help me figure out priorities, some deadlines are urgent');
    expect(routed.map((e) => e.botId)).toContain('E-02');
  });

  it('routes a copy request to Copywright Council', () => {
    const routed = routeToEmployees('Write me homepage copy with a strong CTA');
    expect(routed.map((e) => e.botId)).toContain('E-03');
  });

  it('routes a documentation request to Documentation Manager', () => {
    const routed = routeToEmployees('Is my README still accurate or does it have broken references');
    expect(routed.map((e) => e.botId)).toContain('E-04');
  });

  it('routes a positioning request to Strategic Architect', () => {
    const routed = routeToEmployees('Help me think through a category-of-one positioning strategy against competitors');
    expect(routed.map((e) => e.botId)).toContain('E-01');
  });

  it('returns an empty array — an honest signal, not a forced guess — when nothing genuinely matches', () => {
    const routed = routeToEmployees('I want a totally new capability nothing currently covers');
    expect(routed).toHaveLength(0);
  });
});

describe('ElOrchestrator', () => {
  describe('convene', () => {
    it('produces a real directive routing to the matched employee', async () => {
      const bot = new ElOrchestrator(makeSpec());
      const directive = await bot.convene('Write me homepage copy with a strong CTA');

      expect(directive.matchedEmployees.map((e) => e.botId)).toContain('E-03');
      expect(directive.verdict).toContain('Copywright Council');
    });

    it('honestly reports no match rather than forcing one', async () => {
      const bot = new ElOrchestrator(makeSpec());
      const directive = await bot.convene('I want a totally new capability nothing currently covers');

      expect(directive.matchedEmployees).toHaveLength(0);
      expect(directive.verdict).toContain('No current employee');
    });

    it('signals the swarm when no employee matches', async () => {
      const bot = new ElOrchestrator(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.convene('I want a totally new capability nothing currently covers');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when a real match is found', async () => {
      const bot = new ElOrchestrator(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.convene('Write me homepage copy with a strong CTA');

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks convening without orchestrate:employee-roster permission', async () => {
      const bot = new ElOrchestrator(makeSpec({ permissionScope: [] }));
      await expect(bot.convene('anything')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
