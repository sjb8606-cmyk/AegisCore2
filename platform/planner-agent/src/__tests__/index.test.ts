import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'planner-entities') {
        return {
          enabled: true,
          niche: 'pet-foster',
          entityLabel: 'animal',
          customFields: [],
          tagVocabulary: [],
        };
      }
      if (name === 'planner-matching') {
        return {
          enabled: true,
          matchStrategy: 'reliability-weighted',
          slotDurationMinutes: 60,
          autoCreateContract: false,
          contractNiche: 'planner-shift',
        };
      }
      if (name === 'planner-actors') {
        return {
          enabled: true,
          defaultReliability: 0.7,
          minReliability: 0,
          maxReliability: 1,
        };
      }
      if (name === 'worm-audit') return { enabled: true };
      return {
        enabled: true,
        reasoningProvider: 'mock',
        maxToolCallsPerRequest: 3,
        defaultNiche: 'pet-foster',
        defaultWindowHours: 48,
      };
    }),
  };
});

vi.mock('@platform/incident-breaker', () => ({
  isActorSuspended: vi.fn().mockReturnValue(false),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createActor, __resetPlannerActorsStore } from '@platform/planner-actors';
import {
  createEntity,
  __resetPlannerEntitiesStore,
} from '@platform/planner-entities';
import { __resetPlannerMatchingStore } from '@platform/planner-matching';
import { __resetWormAuditStore } from '@platform/worm-audit';
import {
  queryPlannerAgent,
  parsePlannerIntent,
  __resetPlannerAgentStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-0000000000aa';

describe('planner-agent', () => {
  beforeEach(() => {
    __resetPlannerAgentStore();
    __resetPlannerActorsStore();
    __resetPlannerEntitiesStore();
    __resetPlannerMatchingStore();
    __resetWormAuditStore();
    vi.clearAllMocks();
  });

  it('parsePlannerIntent extracts name', () => {
    const intent = parsePlannerIntent('find someone to watch Max this weekend', {
      defaultNiche: 'pet-foster',
      defaultWindowHours: 48,
    });
    expect(intent.entityNameHint).toBe('Max');
  });

  it('query resolves entity and returns matches', async () => {
    await createActor(tenantId, userId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Alex',
    });
    await createEntity(tenantId, userId, {
      niche: 'pet-foster',
      name: 'Max',
    });
    const result = await queryPlannerAgent(
      tenantId,
      userId,
      'find someone to watch Max this weekend',
    );
    expect(result.entityId).toBeTruthy();
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});
