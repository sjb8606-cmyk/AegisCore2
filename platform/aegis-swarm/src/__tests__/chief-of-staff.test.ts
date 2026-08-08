import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ChiefOfStaffBot, classifyProject, assessLeverage, ProjectStatus } from '../employees/chief-of-staff';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-02',
    role: 'Test Chief of Staff used to verify Eisenhower classification, staleness, and leverage detection.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Chief of Staff used to verify quadrant classification, stale flagging, and leverage assessment.',
    permissionScope: ['read:project-status'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function project(overrides: Partial<ProjectStatus>): ProjectStatus {
  return {
    name: 'Test Project',
    deadlineDaysAway: null,
    blocksOtherWork: false,
    statedPriority: 'medium',
    lastUpdatedDaysAgo: 0,
    ...overrides,
  };
}

describe('assessLeverage (pure Grove leverage logic)', () => {
  it('flags high leverage when a project blocks other work, even with zero explicit downstream count', () => {
    const result = assessLeverage(project({ blocksOtherWork: true, downstreamImpactCount: 0 }));
    expect(result.highLeverage).toBe(true);
  });

  it('flags high leverage when downstream impact meets the threshold, even without blocking anything', () => {
    const result = assessLeverage(project({ blocksOtherWork: false, downstreamImpactCount: 4 }));
    expect(result.highLeverage).toBe(true);
  });

  it('does not flag high leverage for a low-impact, non-blocking, standalone task', () => {
    const result = assessLeverage(project({ blocksOtherWork: false, downstreamImpactCount: 1 }));
    expect(result.highLeverage).toBe(false);
  });

  it('defaults to zero impact and low leverage when downstreamImpactCount is omitted entirely', () => {
    const result = assessLeverage(project({ blocksOtherWork: false }));
    expect(result.highLeverage).toBe(false);
  });

  it('can be high-leverage while landing in the "schedule" quadrant — a real distinction Eisenhower alone would miss', () => {
    const classified = classifyProject(
      project({ blocksOtherWork: false, statedPriority: 'high', deadlineDaysAway: null, downstreamImpactCount: 5 }),
    );
    expect(classified.quadrant).toBe('schedule');
    expect(classified.highLeverage).toBe(true);
  });
});

describe('classifyProject (pure Eisenhower logic)', () => {
  it('classifies a blocking, high-priority project as do_first', () => {
    const result = classifyProject(project({ blocksOtherWork: true, statedPriority: 'high', deadlineDaysAway: 3 }));
    expect(result.quadrant).toBe('do_first');
  });

  it('classifies a high-priority project with no near deadline as schedule', () => {
    const result = classifyProject(project({ statedPriority: 'high', deadlineDaysAway: null }));
    expect(result.quadrant).toBe('schedule');
  });

  it('classifies an urgent-deadline but low-priority project as delegate_or_batch', () => {
    const result = classifyProject(project({ deadlineDaysAway: 2, statedPriority: 'low' }));
    expect(result.quadrant).toBe('delegate_or_batch');
  });

  it('classifies a low-priority, no-deadline project as eliminate_or_defer', () => {
    const result = classifyProject(project({ deadlineDaysAway: null, statedPriority: 'low' }));
    expect(result.quadrant).toBe('eliminate_or_defer');
  });

  it('flags staleness independently of quadrant', () => {
    const doFirstButStale = classifyProject(
      project({ blocksOtherWork: true, statedPriority: 'high', lastUpdatedDaysAgo: 20 }),
    );
    expect(doFirstButStale.quadrant).toBe('do_first');
    expect(doFirstButStale.stale).toBe(true);
  });

  it('does not flag a recently updated project as stale', () => {
    const result = classifyProject(project({ lastUpdatedDaysAgo: 1 }));
    expect(result.stale).toBe(false);
  });
});

describe('ChiefOfStaffBot', () => {
  describe('buildStatusDigest', () => {
    it('sorts real projects into the correct quadrants', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const digest = await bot.buildStatusDigest([
        project({ name: 'A', blocksOtherWork: true, statedPriority: 'high', deadlineDaysAway: 3 }),
        project({ name: 'B', statedPriority: 'high', deadlineDaysAway: null }),
        project({ name: 'C', deadlineDaysAway: 2, statedPriority: 'low' }),
        project({ name: 'D', deadlineDaysAway: null, statedPriority: 'low' }),
      ]);

      expect(digest.doFirst.map((p) => p.name)).toEqual(['A']);
      expect(digest.schedule.map((p) => p.name)).toEqual(['B']);
      expect(digest.delegateOrBatch.map((p) => p.name)).toEqual(['C']);
      expect(digest.eliminateOrDefer.map((p) => p.name)).toEqual(['D']);
    });

    it('surfaces the top priority', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const digest = await bot.buildStatusDigest([
        project({ name: 'Urgent one', blocksOtherWork: true, statedPriority: 'high' }),
        project({ name: 'Someday', statedPriority: 'low' }),
      ]);

      expect(digest.topPriority?.name).toBe('Urgent one');
    });

    it('among multiple do_first items, prefers the high-leverage one as top priority', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const digest = await bot.buildStatusDigest([
        project({ name: 'Do-first but low leverage', blocksOtherWork: false, statedPriority: 'high', deadlineDaysAway: 1 }),
        project({ name: 'Do-first and high leverage', blocksOtherWork: true, statedPriority: 'high', deadlineDaysAway: 1 }),
      ]);

      expect(digest.topPriority?.name).toBe('Do-first and high leverage');
    });

    it('counts stale projects correctly', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const digest = await bot.buildStatusDigest([
        project({ name: 'Fresh', lastUpdatedDaysAgo: 1 }),
        project({ name: 'Stale one', lastUpdatedDaysAgo: 20 }),
        project({ name: 'Stale two', lastUpdatedDaysAgo: 30 }),
      ]);

      expect(digest.staleCount).toBe(2);
    });

    it('counts high-leverage projects correctly', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const digest = await bot.buildStatusDigest([
        project({ name: 'High leverage', downstreamImpactCount: 5 }),
        project({ name: 'Low leverage', downstreamImpactCount: 1 }),
      ]);

      expect(digest.highLeverageCount).toBe(1);
    });

    it('signals the swarm when stale projects exist', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.buildStatusDigest([project({ lastUpdatedDaysAgo: 30 })]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when nothing is stale', async () => {
      const bot = new ChiefOfStaffBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.buildStatusDigest([project({ lastUpdatedDaysAgo: 1 })]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks the digest without read:project-status permission', async () => {
      const bot = new ChiefOfStaffBot(makeSpec({ permissionScope: [] }));
      await expect(bot.buildStatusDigest([project({})])).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
