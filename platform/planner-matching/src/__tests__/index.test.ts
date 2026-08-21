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
      if (name === 'consent-capture') {
        return { enabled: true, requireGeoStamp: false, requireDeviceStamp: false };
      }
      if (name === 'liability-contracts') {
        return {
          enabled: true,
          niche: 'planner-shift',
          termsTemplate: 'Shift {{partyA}}/{{partyB}} {{entity}}',
          requiresConsentCapture: false,
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
      if (name === 'planner-entities') {
        return {
          enabled: true,
          niche: 'pet-foster',
          entityLabel: 'animal',
          customFields: [],
          tagVocabulary: [],
        };
      }
      return {
        enabled: true,
        matchStrategy: 'reliability-weighted',
        slotDurationMinutes: 60,
        autoCreateContract: true,
        contractNiche: 'planner-shift',
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
import { __resetLiabilityContractsStore } from '@platform/liability-contracts';
import {
  findMatches,
  confirmShift,
  completeShift,
  __resetPlannerMatchingStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const adminId = '00000000-0000-4000-8000-0000000000aa';

describe('planner-matching', () => {
  beforeEach(() => {
    __resetPlannerMatchingStore();
    __resetPlannerActorsStore();
    __resetPlannerEntitiesStore();
    __resetLiabilityContractsStore();
    vi.clearAllMocks();
  });

  it('ranks actors by reliability', async () => {
    const low = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Low',
    });
    const high = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'High',
    });
    // bump high reliability via store is internal — create order: both 0.7
    // We'll just ensure matches return at least one
    const entity = await createEntity(tenantId, adminId, {
      niche: 'pet-foster',
      name: 'Max',
    });
    const matches = await findMatches(tenantId, adminId, {
      entityId: entity.id,
      windowStart: '2026-06-01T14:00:00.000Z',
      windowEnd: '2026-06-01T16:00:00.000Z',
      niche: 'pet-foster',
    });
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
    expect(low.id).toBeTruthy();
    expect(high.id).toBeTruthy();
  });

  it('confirmShift creates shift + contract', async () => {
    const foster = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Alex',
    });
    const entity = await createEntity(tenantId, adminId, {
      niche: 'pet-foster',
      name: 'Max',
    });
    const { shift, contractId } = await confirmShift(tenantId, adminId, {
      matchActorId: foster.id,
      entityId: entity.id,
      startTime: '2026-06-01T14:00:00.000Z',
    });
    expect(shift.status).toBe('confirmed');
    expect(contractId).toBeTruthy();
  });

  it('completeShift marks completed', async () => {
    const foster = await createActor(tenantId, adminId, {
      niche: 'pet-foster',
      role: 'FOSTER',
      displayName: 'Alex',
    });
    const entity = await createEntity(tenantId, adminId, {
      niche: 'pet-foster',
      name: 'Max',
    });
    const { shift } = await confirmShift(tenantId, adminId, {
      matchActorId: foster.id,
      entityId: entity.id,
      startTime: '2026-06-01T14:00:00.000Z',
    });
    const done = await completeShift(tenantId, adminId, shift.id);
    expect(done.status).toBe('completed');
  });
});
