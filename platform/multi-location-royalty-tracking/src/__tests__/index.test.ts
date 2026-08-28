import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn(() => ({
    enabled: true
    }))
  };
});

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
  __resetMultiLocationRoyaltyTrackingStore,
  calculateRoyalty,
  recordPayment,
  flagOverdueRoyalties,
  getRoyalty
} from '../index';

describe('multi-location-royalty-tracking', () => {
  beforeEach(() => {
    __resetMultiLocationRoyaltyTrackingStore();
  });

  it('calculates royalty from reported gross revenue', async () => {
    const result = await calculateRoyalty(
      'tenant-1',
      'actor-1',
      'location-1',
      '2026-08',
      10000,
      6
    );

    expect(result.gross_revenue_reported).toBe(10000);
    expect(result.royalty_percentage).toBe(6);
    expect(result.royalty_amount_due).toBe(600);
    expect(result.payment_status).toBe('pending');
  });

  it('records a royalty payment', async () => {
    const royalty = await calculateRoyalty(
      'tenant-1',
      'actor-1',
      'location-1',
      '2026-08',
      10000,
      6
    );

    const result = await recordPayment(
      'tenant-1',
      'actor-1',
      royalty.royalty_id
    );

    expect(result.payment_status).toBe('paid');
  });

  it('flags pending royalties as overdue', async () => {
    await calculateRoyalty(
      'tenant-1',
      'actor-1',
      'location-1',
      '2026-08',
      10000,
      6
    );

    await calculateRoyalty(
      'tenant-1',
      'actor-1',
      'location-2',
      '2026-08',
      20000,
      5
    );

    const result = await flagOverdueRoyalties(
      'tenant-1',
      'actor-1',
      15
    );

    expect(result).toHaveLength(2);
    expect(
      result.every(
        (record) =>
          record.payment_status === 'overdue'
      )
    ).toBe(true);
  });

  it('stores royalty records by location and reporting period', async () => {
    await calculateRoyalty(
      'tenant-1',
      'actor-1',
      'location-1',
      '2026-08',
      5000,
      4
    );

    const result = getRoyalty(
      'tenant-1',
      'location-1',
      '2026-08'
    );

    expect(result?.royalty_amount_due).toBe(200);
  });
});
