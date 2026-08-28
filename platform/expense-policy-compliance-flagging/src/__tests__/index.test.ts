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
    enabled: true,
    default_rules: []
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
  __resetExpensePolicyComplianceFlaggingStore,
  createPolicyRule,
  checkPolicyCompliance,
  requestJustification,
  overrideFlag,
  getExpensePolicyFlags
} from '../index';

describe(
  'expense-policy-compliance-flagging',
  () => {
    beforeEach(() => {
      __resetExpensePolicyComplianceFlaggingStore();
    });

    it('creates a tenant policy rule', async () => {
      const rule =
        await createPolicyRule(
          'tenant-1',
          'admin-1',
          {
            id: 'travel-max-100',
            category: 'Travel',
            max_amount: 100,
            severity:
              'requires_justification'
          }
        );

      expect(rule.id).toBe(
        'travel-max-100'
      );

      expect(rule.active).toBe(true);
    });

    it('flags an expense that violates policy', async () => {
      await createPolicyRule(
        'tenant-1',
        'admin-1',
        {
          id: 'travel-max-100',
          category: 'Travel',
          max_amount: 100,
          severity:
            'requires_justification'
        }
      );

      const flags =
        await checkPolicyCompliance(
          'tenant-1',
          'employee-1',
          'expense-1',
          175,
          'Travel'
        );

      expect(flags).toHaveLength(1);
      expect(flags[0].severity).toBe(
        'requires_justification'
      );
    });

    it('ignores rules for unrelated categories', async () => {
      await createPolicyRule(
        'tenant-1',
        'admin-1',
        {
          id: 'travel-max-100',
          category: 'Travel',
          max_amount: 100,
          severity: 'blocked'
        }
      );

      const flags =
        await checkPolicyCompliance(
          'tenant-1',
          'employee-1',
          'expense-1',
          175,
          'Office'
        );

      expect(flags).toHaveLength(0);
    });

    it('supports employee justification', async () => {
      await createPolicyRule(
        'tenant-1',
        'admin-1',
        {
          id: 'travel-max-100',
          category: 'Travel',
          max_amount: 100,
          severity:
            'requires_justification'
        }
      );

      const flags =
        await checkPolicyCompliance(
          'tenant-1',
          'employee-1',
          'expense-1',
          175,
          'Travel'
        );

      const updated =
        await requestJustification(
          'tenant-1',
          'employee-1',
          flags[0].flag_id,
          'Emergency travel required'
        );

      expect(
        updated.employee_justification
      ).toBe(
        'Emergency travel required'
      );
    });

    it('supports authorized override', async () => {
      await createPolicyRule(
        'tenant-1',
        'admin-1',
        {
          id: 'travel-max-100',
          category: 'Travel',
          max_amount: 100,
          severity: 'blocked'
        }
      );

      const flags =
        await checkPolicyCompliance(
          'tenant-1',
          'employee-1',
          'expense-1',
          175,
          'Travel'
        );

      const updated =
        await overrideFlag(
          'tenant-1',
          'manager-1',
          flags[0].flag_id,
          'manager-1'
        );

      expect(updated.overridden).toBe(
        true
      );

      expect(
        updated.overridden_by
      ).toBe('manager-1');
    });

    it('enforces tenant isolation', async () => {
      await createPolicyRule(
        'tenant-1',
        'admin-1',
        {
          id: 'travel-max-100',
          category: 'Travel',
          max_amount: 100,
          severity: 'blocked'
        }
      );

      const flags =
        await checkPolicyCompliance(
          'tenant-1',
          'employee-1',
          'expense-1',
          175,
          'Travel'
        );

      expect(
        getExpensePolicyFlags(
          'tenant-2',
          'expense-1'
        )
      ).toHaveLength(0);

      expect(flags).toHaveLength(1);
    });
  }
);
