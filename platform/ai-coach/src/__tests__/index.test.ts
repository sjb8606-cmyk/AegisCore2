import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), // force default config for every test
  readFileSync: vi.fn(),
}));

import { withTenantQuery } from '../../../tenancy/src/index';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// loadConfig() caches its result in a module-private closure variable with no
// reset hook exported. vi.resetModules() + a fresh dynamic import is the only
// way to get a clean config per test — reaching into the module object does
// nothing, since the variable isn't attached to anything reachable from outside.
async function freshAiCoachService() {
  vi.resetModules();
  const mod = await import('../index');
  return mod.AiCoachService;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('analyzeUserPerformance', () => {
  it('rejects context data containing an adversarial injection marker', async () => {
    const AiCoachService = await freshAiCoachService();
    await expect(
      AiCoachService.analyzeUserPerformance(TENANT_ID, USER_ID, { note: 'adversarial_injection attempt' })
    ).rejects.toThrow('Adversarial prompt injection detected in coaching context');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws INTERNAL when the insert returns no rows', async () => {
    const AiCoachService = await freshAiCoachService();
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(
      AiCoachService.analyzeUserPerformance(TENANT_ID, USER_ID, { note: 'fine' })
    ).rejects.toThrow('Failed to record coaching analysis session');
  });

  // KNOWN DEFECT — documented, not hidden.
  // This "analysis" is not derived from contextData at all: the insights object
  // is a hardcoded literal. Two completely different context payloads produce
  // byte-identical "personalized" output. Locking this in so it fails loudly
  // the moment someone wires up a real analysis step.
  it('DEFECT: returns identical hardcoded insights regardless of context content', async () => {
    const AiCoachService = await freshAiCoachService();
    (withTenantQuery as any).mockResolvedValue([{ id: 'session-1' }]);

    const resultA = await AiCoachService.analyzeUserPerformance(TENANT_ID, USER_ID, {
      recentActivity: 'completed onboarding, zero errors',
    });
    const resultB = await AiCoachService.analyzeUserPerformance(TENANT_ID, USER_ID, {
      recentActivity: 'failed every task, hostile to teammates',
    });

    expect(resultA).toEqual(resultB); // should NOT be true for a real coaching engine
    expect(resultA.health_score).toBe(0.92);
    // TODO(ai-coach launch blocker): replace with a real model call keyed on contextData.
  });
});

describe('createCoachingGoal', () => {
  it('rejects an empty goal_title before hitting the database', async () => {
    const AiCoachService = await freshAiCoachService();
    await expect(
      AiCoachService.createCoachingGoal(TENANT_ID, USER_ID, { goal_title: '' })
    ).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('creates a goal and returns the inserted row', async () => {
    const AiCoachService = await freshAiCoachService();
    const row = { id: 'goal-1', goal_title: 'Improve async comms' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);

    const result = await AiCoachService.createCoachingGoal(TENANT_ID, USER_ID, {
      goal_title: 'Improve async comms',
    });

    expect(result).toEqual(row);
  });
});

describe('generateRecommendations', () => {
  // KNOWN DEFECT — documented, not hidden.
  // The function queries user_skills, assigns it to `skills`, then never reads
  // that variable again. The two recommendations inserted are hardcoded and
  // unrelated to the tenant's actual skill data — one of them literally
  // references TypeScript compiler error codes, which has nothing to do with
  // "coaching recommendations" for an end user.
  it('DEFECT: ignores the fetched skill data and always inserts the same two hardcoded recommendations', async () => {
    const AiCoachService = await freshAiCoachService();
    (withTenantQuery as any).mockResolvedValueOnce([{ skill_name: 'Leadership', current_level: 0.9 }]); // skills query — ignored
    (withTenantQuery as any).mockResolvedValue([]); // both insert calls

    const recs = await AiCoachService.generateRecommendations(TENANT_ID, USER_ID);

    expect(recs).toEqual([
      'Review platform compiler diagnostic codes TS2353 and TS2558',
      'Deploy remaining Universal Secure SaaS Spec v3.6 core modules',
    ]);
    // TODO(ai-coach launch blocker): derive recommendations from the fetched `skills`.
  });

  it('blocks when adaptiveRecommendations tier is off', async () => {
    const AiCoachService = await freshAiCoachService();
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify({
        enabled: true,
        tiers: { adaptiveRecommendations: false },
        limits: {},
      })
    );
    await expect(AiCoachService.generateRecommendations(TENANT_ID, USER_ID)).rejects.toThrow(
      'Adaptive coaching recommendations are blocked on current tier'
    );
  });
});

describe('fetchGoals', () => {
  it('returns whatever rows the query yields, capped by the query itself at 100', async () => {
    const AiCoachService = await freshAiCoachService();
    const rows = [{ id: 'g1' }, { id: 'g2' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const result = await AiCoachService.fetchGoals(TENANT_ID, USER_ID);
    expect(result).toEqual(rows);
  });
});
