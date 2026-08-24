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
  __resetBrandComplianceChecklistStore,
  assignChecklist,
  submitAudit,
  getComplianceHistory,
  getChecklist
} from '../index';

describe('brand-compliance-checklist', () => {
  beforeEach(() => {
    __resetBrandComplianceChecklistStore();
  });

  it('assigns a checklist to a franchise location', async () => {
    const result = await assignChecklist(
      'tenant-1',
      'actor-1',
      'location-1',
      'template-1'
    );

    expect(result.location_id).toBe(
      'location-1'
    );

    expect(
      result.checklist_template_id
    ).toBe('template-1');

    expect(result.overall_score).toBe(0);
  });

  it('calculates the compliance score', async () => {
    const checklist =
      await assignChecklist(
        'tenant-1',
        'actor-1',
        'location-1',
        'template-1'
      );

    const result = await submitAudit(
      'tenant-1',
      'actor-1',
      checklist.checklist_id,
      [
        {
          item: 'Exterior signage',
          compliant: true
        },
        {
          item: 'Uniform standards',
          compliant: true
        },
        {
          item: 'Cleaning standards',
          compliant: false,
          notes: 'Requires follow-up'
        },
        {
          item: 'Approved materials',
          compliant: false
        }
      ]
    );

    expect(result.overall_score).toBe(50);
    expect(result.items).toHaveLength(4);
  });

  it('returns compliance history for a location', async () => {
    await assignChecklist(
      'tenant-1',
      'actor-1',
      'location-1',
      'template-1'
    );

    await assignChecklist(
      'tenant-1',
      'actor-1',
      'location-1',
      'template-2'
    );

    await assignChecklist(
      'tenant-1',
      'actor-1',
      'location-2',
      'template-1'
    );

    const history =
      await getComplianceHistory(
        'tenant-1',
        'actor-1',
        'location-1'
      );

    expect(history).toHaveLength(2);
    expect(
      history.every(
        (item) =>
          item.location_id === 'location-1'
      )
    ).toBe(true);
  });

  it('enforces tenant isolation', async () => {
    const checklist =
      await assignChecklist(
        'tenant-1',
        'actor-1',
        'location-1',
        'template-1'
      );

    expect(
      getChecklist(
        'tenant-2',
        checklist.checklist_id
      )
    ).toBeUndefined();
  });
});
