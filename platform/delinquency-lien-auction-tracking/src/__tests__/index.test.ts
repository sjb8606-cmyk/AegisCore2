import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn(() => ({
    enabled: true
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
  __resetDelinquencyLienAuctionTrackingStore,
  flagDelinquent,
  fileLien,
  scheduleAuction,
  getDelinquency
} from '../index';

describe('delinquency-lien-auction-tracking', () => {
  beforeEach(() => {
    __resetDelinquencyLienAuctionTrackingStore();
  });

  it('flags an overdue storage tenant', async () => {
    const result = await flagDelinquent(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-101',
      15
    );

    expect(result.days_overdue).toBe(15);
    expect(result.status).toBe('late');
  });

  it('files a lien against an existing delinquency', async () => {
    const delinquency = await flagDelinquent(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-101',
      30
    );

    const result = await fileLien(
      'tenant-1',
      'actor-1',
      delinquency.delinquency_id,
      '2026-08-23'
    );

    expect(result.status).toBe('lien_filed');
    expect(result.lien_filed_date).toBe('2026-08-23');
  });

  it('requires a filed lien before scheduling auction', async () => {
    const delinquency = await flagDelinquent(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-101',
      45
    );

    await expect(
      scheduleAuction(
        'tenant-1',
        'actor-1',
        delinquency.delinquency_id,
        '2026-09-30'
      )
    ).rejects.toThrow(
      'A lien must be filed before an auction is scheduled'
    );
  });

  it('schedules an auction after lien filing', async () => {
    const delinquency = await flagDelinquent(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-101',
      60
    );

    await fileLien(
      'tenant-1',
      'actor-1',
      delinquency.delinquency_id,
      '2026-08-23'
    );

    const result = await scheduleAuction(
      'tenant-1',
      'actor-1',
      delinquency.delinquency_id,
      '2026-10-01'
    );

    expect(result.status).toBe('auction_scheduled');

    const stored = getDelinquency(
      'tenant-1',
      'customer-1',
      'unit-101'
    );

    expect(stored?.auction_scheduled_date).toBe(
      '2026-10-01'
    );
  });
});
