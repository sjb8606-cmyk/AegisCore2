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

    constructor(
      code: string,
      message: string
    ) {
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
  __resetFranchiseePerformanceScorecardStore,
  generateScorecard,
  getNetworkRankings,
  flagUnderperformingLocations,
  getScorecard
} from '../index';

describe(
  'franchisee-performance-scorecard',
  () => {
    beforeEach(() => {
      __resetFranchiseePerformanceScorecardStore();
    });

    it('generates a scorecard', async () => {
      const result =
        await generateScorecard(
          'tenant-1',
          'actor-1',
          {
            location_id: 'location-1',
            reporting_period: '2026-Q3',
            revenue_rank: 2,
            compliance_score: 95,
            customer_satisfaction_score: 90
          }
        );

      expect(result.location_id).toBe(
        'location-1'
      );

      expect(result.compliance_score).toBe(
        95
      );

      expect(
        result.customer_satisfaction_score
      ).toBe(90);
    });

    it('ranks franchise locations', async () => {
      await generateScorecard(
        'tenant-1',
        'actor-1',
        {
          location_id: 'location-1',
          reporting_period: '2026-Q3',
          revenue_rank: 1,
          compliance_score: 70,
          customer_satisfaction_score: 70
        }
      );

      await generateScorecard(
        'tenant-1',
        'actor-1',
        {
          location_id: 'location-2',
          reporting_period: '2026-Q3',
          revenue_rank: 2,
          compliance_score: 95,
          customer_satisfaction_score: 95
        }
      );

      const rankings =
        await getNetworkRankings(
          'tenant-1',
          'actor-1',
          '2026-Q3'
        );

      expect(rankings).toHaveLength(2);
      expect(
        rankings[0].location_id
      ).toBe('location-2');

      expect(
        rankings[0].overall_rank
      ).toBe(1);

      expect(
        rankings[1].overall_rank
      ).toBe(2);
    });

    it('flags underperforming locations', async () => {
      await generateScorecard(
        'tenant-1',
        'actor-1',
        {
          location_id: 'location-1',
          reporting_period: '2026-Q3',
          revenue_rank: 5,
          compliance_score: 55,
          customer_satisfaction_score: 60
        }
      );

      await generateScorecard(
        'tenant-1',
        'actor-1',
        {
          location_id: 'location-2',
          reporting_period: '2026-Q3',
          revenue_rank: 1,
          compliance_score: 95,
          customer_satisfaction_score: 90
        }
      );

      const flagged =
        await flagUnderperformingLocations(
          'tenant-1',
          'actor-1',
          70,
          '2026-Q3'
        );

      expect(flagged).toHaveLength(1);
      expect(
        flagged[0].location_id
      ).toBe('location-1');
    });

    it('enforces tenant isolation', async () => {
      const scorecard =
        await generateScorecard(
          'tenant-1',
          'actor-1',
          {
            location_id: 'location-1',
            reporting_period: '2026-Q3',
            revenue_rank: 1,
            compliance_score: 90,
            customer_satisfaction_score: 90
          }
        );

      expect(
        getScorecard(
          'tenant-2',
          'location-1',
          '2026-Q3'
        )
      ).toBeUndefined();

      expect(scorecard.tenant_id).toBe(
        'tenant-1'
      );
    });
  }
);
