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
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      weights: {
        cost: 0.25,
        irreversibility: 0.3,
        externalImpact: 0.2,
        dataSensitivity: 0.15,
        novelty: 0.1,
      },
      thresholds: { low: 2.0, medium: 3.0, high: 4.0 },
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  calculateRisk,
  scoreDecision,
  listScoresForRun,
  __resetRiskScoringStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const runId = 'run-1';

const defaultConfig = {
  enabled: true,
  weights: {
    cost: 0.25,
    irreversibility: 0.3,
    externalImpact: 0.2,
    dataSensitivity: 0.15,
    novelty: 0.1,
  },
  thresholds: { low: 2.0, medium: 3.0, high: 4.0 },
};

describe('risk-scoring', () => {
  beforeEach(() => {
    __resetRiskScoringStore();
    vi.clearAllMocks();
  });

  it('low risk does not fire gate', () => {
    const r = calculateRisk(
      {
        cost: 1,
        irreversibility: 1,
        externalImpact: 1,
        dataSensitivity: 1,
        novelty: 1,
      },
      defaultConfig,
    );
    expect(r.score).toBe(1);
    expect(r.gateFired).toBe(false);
    expect(r.label).toBe('low');
  });

  it('high irreversibility fires gate', () => {
    const r = calculateRisk(
      {
        cost: 2,
        irreversibility: 5,
        externalImpact: 4,
        dataSensitivity: 3,
        novelty: 2,
      },
      defaultConfig,
    );
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.gateFired).toBe(true);
  });

  it('scoreDecision persists audit record', async () => {
    const rec = await scoreDecision(tenantId, actorId, {
      runId,
      step: 1,
      decision: 'send_email',
      cost: 1,
      irreversibility: 4,
      externalImpact: 3,
      dataSensitivity: 2,
      novelty: 1,
    });
    expect(rec.id).toBeTruthy();
    const list = await listScoresForRun(tenantId, runId);
    expect(list).toHaveLength(1);
  });

  it('clamps factors to 0–5', () => {
    const r = calculateRisk(
      {
        cost: 99,
        irreversibility: -3,
        externalImpact: 2,
        dataSensitivity: 2,
        novelty: 2,
      },
      defaultConfig,
    );
    expect(r.factors.cost).toBe(5);
    expect(r.factors.irreversibility).toBe(0);
  });
});
