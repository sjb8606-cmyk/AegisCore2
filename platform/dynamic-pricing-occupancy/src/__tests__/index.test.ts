import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn(() => ({
    enabled: true,
    occupancy_thresholds: [
      { minimum_percent: 0, multiplier: 1 },
      { minimum_percent: 70, multiplier: 1.1 },
      { minimum_percent: 85, multiplier: 1.2 },
      { minimum_percent: 95, multiplier: 1.3 }
    ]
  }))
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', () => {
  class TestAppError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    AppError: TestAppError,
    ErrorCode: {
      BAD_REQUEST: 'BAD_REQUEST',
      FORBIDDEN: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND'
    },
    runCrudOperation: async (args: {
      action: () => Promise<unknown>;
    }) => args.action()
  };
});

import {
  __resetDynamicPricingOccupancyStore,
  calculateDynamicRate,
  applyManualOverride,
  getOccupancyReport
} from '../index';

describe('dynamic-pricing-occupancy', () => {
  beforeEach(() => {
    __resetDynamicPricingOccupancyStore();
  });

  it('calculates a higher rate at high occupancy', async () => {
    const result = await calculateDynamicRate(
      'tenant-1',
      'actor-1',
      'facility-1',
      'medium',
      100,
      90
    );

    expect(result.dynamic_rate).toBe(120);
    expect(result.manual_override).toBe(false);
  });

  it('applies a manual rate override', async () => {
    const result = await applyManualOverride(
      'tenant-1',
      'actor-1',
      'facility-1',
      'medium',
      175
    );

    expect(result.dynamic_rate).toBe(175);
    expect(result.manual_override).toBe(true);
  });

  it('preserves manual override during recalculation', async () => {
    await applyManualOverride(
      'tenant-1',
      'actor-1',
      'facility-1',
      'medium',
      175
    );

    const result = await calculateDynamicRate(
      'tenant-1',
      'actor-1',
      'facility-1',
      'medium',
      100,
      95
    );

    expect(result.dynamic_rate).toBe(175);
    expect(result.manual_override).toBe(true);
  });

  it('returns only the facility occupancy records', async () => {
    await calculateDynamicRate(
      'tenant-1',
      'actor-1',
      'facility-1',
      'small',
      80,
      50
    );

    await calculateDynamicRate(
      'tenant-1',
      'actor-1',
      'facility-2',
      'small',
      80,
      50
    );

    const report = getOccupancyReport(
      'tenant-1',
      'facility-1'
    );

    expect(report).toHaveLength(1);
    expect(report[0].facility_id).toBe('facility-1');
  });
});
