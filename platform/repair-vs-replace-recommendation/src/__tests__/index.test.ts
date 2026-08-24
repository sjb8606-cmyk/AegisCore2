import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) => options.action()
  };
});

import {
  __resetRepairVsReplaceRecommendationStore,
  generateRecommendation,
  recordClientDecision
} from '../index';

describe('repair-vs-replace-recommendation', () => {
  beforeEach(() => {
    __resetRepairVsReplaceRecommendationStore();
  });

  it('generates a repair recommendation', async () => {
    const result = await generateRecommendation(
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      200,
      4,
      1000
    );

    expect(result.recommendation).toBe('repair');
  });

  it('rejects invalid replacement cost', async () => {
    await expect(
      generateRecommendation(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        200,
        4,
        0
      )
    ).rejects.toThrow();
  });

  it('records a client decision and enforces tenant isolation', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const result = await generateRecommendation(
      tenantId,
      actorId,
      crypto.randomUUID(),
      500,
      8,
      1000
    );

    const updated = await recordClientDecision(
      tenantId,
      actorId,
      result.recommendationId,
      'replace'
    );

    expect(updated.clientDecision).toBe('replace');

    await expect(
      recordClientDecision(
        crypto.randomUUID(),
        actorId,
        result.recommendationId,
        'repair'
      )
    ).rejects.toThrow();
  });
});
