import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import {
  createModel,
  evaluate,
  overrideDecision,
  getDecisionDetails,
} from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const MODEL_ID = '44444444-4444-4444-4444-444444444444';
const DECISION_ID = '55555555-5555-5555-5555-555555555555';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tier gating', () => {
  it('blocks evaluate when humanOverride is not enabled', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: false }, limits: { decisionsPerMonth: 100 } });
    await expect(evaluate(TENANT_ID, USER_ID, { modelId: MODEL_ID, inputData: {} })).rejects.toThrow(
      'AI Decisions requires the HARDENED tier enabled with Overrides'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });
});

describe('evaluate — rule scoring', () => {
  it('enforces the monthly decision limit before loading a model', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 5 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '5' }]); // count >= limit

    await expect(evaluate(TENANT_ID, USER_ID, { modelId: MODEL_ID, inputData: {} })).rejects.toThrow(
      'Monthly evaluated decision limits reached'
    );
    expect(withTenantQuery).toHaveBeenCalledTimes(1); // never got to the model lookup
  });

  it('throws NOT_FOUND when the model does not exist', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 100 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([]); // no model row

    await expect(evaluate(TENANT_ID, USER_ID, { modelId: MODEL_ID, inputData: {} })).rejects.toThrow(
      'Decision model not found'
    );
  });

  it('computes a real weighted score: all rules pass -> outcome "pass"', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 100 } });
    const model = {
      rules: [
        { id: 'r1', field: 'credit_score', operator: 'gte', value: 650 },
        { id: 'r2', field: 'income', operator: 'gte', value: 40000 },
      ],
      weights: { r1: '1.0', r2: '1.0' },
      thresholds: { pass: 0.7 },
    };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([model])
      .mockResolvedValueOnce([{ id: DECISION_ID, outcome: 'pass', confidence: 1.0 }]);

    await evaluate(TENANT_ID, USER_ID, {
      modelId: MODEL_ID,
      inputData: { credit_score: 700, income: 50000 },
    });

    const insertParams = (withTenantQuery as any).mock.calls[2][1];
    expect(insertParams[4]).toBe('pass');   // outcome
    expect(insertParams[5]).toBe(1.0);      // confidence — both rules passed
  });

  it('computes a real weighted score: rules fail -> outcome "fail", below threshold', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 100 } });
    const model = {
      rules: [
        { id: 'r1', field: 'credit_score', operator: 'gte', value: 650 },
        { id: 'r2', field: 'income', operator: 'gte', value: 40000 },
      ],
      weights: { r1: '1.0', r2: '1.0' },
      thresholds: { pass: 0.7 },
    };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([model])
      .mockResolvedValueOnce([{ id: DECISION_ID, outcome: 'fail' }]);

    // credit_score fails (600 < 650), income passes -> confidence 0.5, below 0.7 threshold
    await evaluate(TENANT_ID, USER_ID, {
      modelId: MODEL_ID,
      inputData: { credit_score: 600, income: 50000 },
    });

    const insertParams = (withTenantQuery as any).mock.calls[2][1];
    expect(insertParams[4]).toBe('fail'); // outcome
    expect(insertParams[5]).toBe(0.5);    // confidence — exactly one of two rules passed
  });

  it('defaults confidence to 1.0 (auto-pass) when a model has zero rules', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true }, limits: { decisionsPerMonth: 100 } });
    const model = { rules: [], weights: {}, thresholds: { pass: 0.7 } };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([model])
      .mockResolvedValueOnce([{ id: DECISION_ID }]);

    await evaluate(TENANT_ID, USER_ID, { modelId: MODEL_ID, inputData: {} });

    const insertParams = (withTenantQuery as any).mock.calls[2][1];
    expect(insertParams[4]).toBe('pass'); // confidence 1.0 >= any reasonable threshold
    expect(insertParams[5]).toBe(1.0);
  });
});

describe('overrideDecision', () => {
  it('throws NOT_FOUND when the target decision does not exist', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true } });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(
      overrideDecision(TENANT_ID, DECISION_ID, 'pass', 'manual review', ADMIN_ID)
    ).rejects.toThrow('Decision not found to override');
  });

  it('records an override row with the resolving admin and reason', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: DECISION_ID }])
      .mockResolvedValueOnce([{ id: 'override-1', new_outcome: 'pass', reason: 'manual review' }]);

    const result = await overrideDecision(TENANT_ID, DECISION_ID, 'pass', 'manual review', ADMIN_ID);

    expect(result).toEqual({ id: 'override-1', new_outcome: 'pass', reason: 'manual review' });
    const insertParams = (withTenantQuery as any).mock.calls[1][1];
    expect(insertParams[3]).toBe('pass');
    expect(insertParams[4]).toBe('manual review');
  });
});

describe('getDecisionDetails', () => {
  it('throws NOT_FOUND when the decision does not exist', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true } });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(getDecisionDetails(TENANT_ID, DECISION_ID)).rejects.toThrow('Decision details not found');
  });

  it('attaches override history to the decision', async () => {
    mockConfig({ enabled: true, tiers: { humanOverride: true } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: DECISION_ID, outcome: 'fail' }])
      .mockResolvedValueOnce([{ id: 'override-1', new_outcome: 'pass', reason: 'manual review' }]);

    const result = await getDecisionDetails(TENANT_ID, DECISION_ID);

    expect(result.id).toBe(DECISION_ID);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0].new_outcome).toBe('pass');
  });
});
