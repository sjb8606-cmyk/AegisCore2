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
  __resetDentalCaseIntakeTrackingStore,
  createCase,
  advanceStage,
  flagOverdueCases,
  getCase
} from '../index';

describe(
  'dental-case-intake-tracking',
  () => {
    beforeEach(() => {
      __resetDentalCaseIntakeTrackingStore();
    });

    it('creates a dental case at intake', async () => {
      const result =
        await createCase(
          'tenant-1',
          'actor-1',
          'dentist-1',
          'PATIENT-001',
          'crown',
          '2099-12-31T12:00:00.000Z',
          true
        );

      expect(result.case_type).toBe(
        'crown'
      );

      expect(
        result.production_stage
      ).toBe('intake');

      expect(result.rush_order).toBe(
        true
      );
    });

    it('advances through production stages', async () => {
      const dentalCase =
        await createCase(
          'tenant-1',
          'actor-1',
          'dentist-1',
          'PATIENT-002',
          'implant',
          '2099-12-31T12:00:00.000Z'
        );

      const design =
        await advanceStage(
          'tenant-1',
          'actor-1',
          dentalCase.case_id,
          'design'
        );

      expect(
        design.production_stage
      ).toBe('design');

      const fabrication =
        await advanceStage(
          'tenant-1',
          'actor-1',
          dentalCase.case_id,
          'milling_fabrication'
        );

      expect(
        fabrication.production_stage
      ).toBe(
        'milling_fabrication'
      );

      const shipped =
        await advanceStage(
          'tenant-1',
          'actor-1',
          dentalCase.case_id,
          'shipped'
        );

      expect(
        shipped.production_stage
      ).toBe('shipped');
    });

    it('prevents production stages moving backward', async () => {
      const dentalCase =
        await createCase(
          'tenant-1',
          'actor-1',
          'dentist-1',
          'PATIENT-003',
          'bridge',
          '2099-12-31T12:00:00.000Z'
        );

      await advanceStage(
        'tenant-1',
        'actor-1',
        dentalCase.case_id,
        'design'
      );

      await expect(
        advanceStage(
          'tenant-1',
          'actor-1',
          dentalCase.case_id,
          'intake'
        )
      ).rejects.toThrow(
        'Production stage cannot move backward'
      );
    });

    it('flags cases due within the requested window', async () => {
      const soon =
        new Date(
          Date.now() +
          24 * 60 * 60 * 1000
        ).toISOString();

      await createCase(
        'tenant-1',
        'actor-1',
        'dentist-1',
        'PATIENT-004',
        'denture',
        soon
      );

      await createCase(
        'tenant-1',
        'actor-1',
        'dentist-1',
        'PATIENT-005',
        'crown',
        '2099-12-31T12:00:00.000Z'
      );

      const flagged =
        await flagOverdueCases(
          'tenant-1',
          'actor-1',
          2
        );

      expect(flagged).toHaveLength(1);
      expect(
        flagged[0].patient_reference
      ).toBe('PATIENT-004');
    });

    it('does not expose another tenant case', async () => {
      const dentalCase =
        await createCase(
          'tenant-1',
          'actor-1',
          'dentist-1',
          'PATIENT-006',
          'crown',
          '2099-12-31T12:00:00.000Z'
        );

      expect(
        getCase(
          'tenant-2',
          dentalCase.case_id
        )
      ).toBeUndefined();
    });
  }
);
