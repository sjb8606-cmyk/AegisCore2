import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createBudget, submitBudget, lockBudget, getBudgetDetails } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const BUDGET_ID = '44444444-4444-4444-4444-444444444444';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

const validConfig = {
  enabled: true,
  tiers: { budgetLocking: true, financialSnapshots: true },
  limits: { budgets: 100 },
  thresholds: { warningVariancePercent: 10, criticalVariancePercent: 25, approvalThresholdAmount: 10000 },
};

describe('createBudget', () => {
  it('blocks when the vertical is disabled', async () => {
    mockConfig({ ...validConfig, enabled: false });
    await expect(
      createBudget(TENANT_ID, USER_ID, { name: 'Q1', budgetType: 'department', fiscalYear: 2026, totalBudget: 0 })
    ).rejects.toThrow('Budgeting vertical is disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('enforces the budget count limit', async () => {
    mockConfig({ ...validConfig, limits: { budgets: 2 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '2' }]);
    await expect(
      createBudget(TENANT_ID, USER_ID, { name: 'Q1', budgetType: 'department', fiscalYear: 2026, totalBudget: 0 })
    ).rejects.toThrow('Monthly budgeting limits reached');
  });

  it('sums line item amounts into total_budget_cents', async () => {
    mockConfig(validConfig);
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ seq: '0' }])
      .mockResolvedValueOnce([{ id: BUDGET_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await createBudget(TENANT_ID, USER_ID, {
      name: 'Q1',
      budgetType: 'department',
      fiscalYear: 2026,
      totalBudget: 0,
      lineItems: [{ name: 'Salaries', amountCents: 500000 }, { name: 'Software', amountCents: 25000 }],
    });

    expect(result.total_budget_cents).toBe(525000);
  });

  it('generates a budget_code in BDG-YYYY-#### format', async () => {
    mockConfig(validConfig);
    const year = new Date().getFullYear();
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ seq: '3' }])
      .mockResolvedValueOnce([{ id: BUDGET_ID }])
      .mockResolvedValueOnce([]);

    await createBudget(TENANT_ID, USER_ID, { name: 'Q1', budgetType: 'department', fiscalYear: 2026, totalBudget: 0 });

    const headerParams = (withTenantQuery as any).mock.calls[2][1];
    expect(headerParams[2]).toBe(`BDG-${year}-0004`);
  });
});

describe('submitBudget', () => {
  it('throws NOT_FOUND when the budget does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(submitBudget(TENANT_ID, BUDGET_ID, USER_ID)).rejects.toThrow('Budget not found');
  });

  it('rejects submitting a budget that is not in draft status', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'locked' }]);
    await expect(submitBudget(TENANT_ID, BUDGET_ID, USER_ID)).rejects.toThrow('Only draft budgets can be submitted');
  });

  it('transitions a draft budget to submitted', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'draft' }]).mockResolvedValueOnce([]);
    const result = await submitBudget(TENANT_ID, BUDGET_ID, USER_ID);
    expect(result).toEqual({ success: true, status: 'submitted' });
  });

  // GAP — documented, not hidden. Confirmed by grep: no approveBudget()
  // function exists anywhere in this file, despite a comment here pointing
  // to one. getBudgetDetails() queries budget_approvals, but nothing in this
  // module ever writes to that table — approvals can never actually happen.
  it('GAP: submitting a budget never creates any row in budget_approvals, and no approveBudget() exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'draft' }]).mockResolvedValueOnce([]);
    await submitBudget(TENANT_ID, BUDGET_ID, USER_ID);
    expect(withTenantQuery).toHaveBeenCalledTimes(2);
    // TODO(budgeting launch blocker): implement approveBudget() or remove the
    // budget_approvals read in getBudgetDetails() if approvals are out of scope.
  });
});

describe('lockBudget', () => {
  it('blocks when budgetLocking tier is disabled', async () => {
    mockConfig({ ...validConfig, tiers: { budgetLocking: false } });
    await expect(lockBudget(TENANT_ID, BUDGET_ID, ADMIN_ID)).rejects.toThrow('Budget locking disabled');
  });

  it('throws NOT_FOUND when the budget does not exist', async () => {
    mockConfig(validConfig);
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(lockBudget(TENANT_ID, BUDGET_ID, ADMIN_ID)).rejects.toThrow('Budget not found to lock');
  });

  // BUG — documented, not hidden. version_number is hardcoded to 1 on every
  // call, regardless of how many budget_versions rows already exist for this
  // budget. A second lock cycle (after unlock+edit) would attempt to insert
  // a colliding version_number=1 instead of incrementing.
  it('BUG: always inserts version_number 1, never incrementing for repeat locks', async () => {
    mockConfig(validConfig);
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: BUDGET_ID, status: 'submitted' }])
      .mockResolvedValueOnce([{ id: BUDGET_ID, status: 'locked' }])
      .mockResolvedValueOnce([{ name: 'Salaries', amount_cents: 500000 }])
      .mockResolvedValueOnce([]);

    await lockBudget(TENANT_ID, BUDGET_ID, ADMIN_ID);

    const versionParams = (withTenantQuery as any).mock.calls[3][1];
    expect(versionParams).toEqual(expect.arrayContaining([BUDGET_ID]));
    // The query itself hardcodes `VALUES ($1, $2, $3, 1, $4)` — version_number
    // isn't even a bound parameter, confirming it can never be anything but 1.
    // TODO(budgeting bug): compute version_number from existing budget_versions count + 1.
  });

  it('skips the snapshot entirely when financialSnapshots tier is off', async () => {
    mockConfig({ ...validConfig, tiers: { budgetLocking: true, financialSnapshots: false } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: BUDGET_ID, status: 'submitted' }])
      .mockResolvedValueOnce([{ id: BUDGET_ID, status: 'locked' }]);

    await lockBudget(TENANT_ID, BUDGET_ID, ADMIN_ID);

    expect(withTenantQuery).toHaveBeenCalledTimes(2);
  });
});

describe('getBudgetDetails', () => {
  it('throws NOT_FOUND when the budget does not exist', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(getBudgetDetails(TENANT_ID, BUDGET_ID)).rejects.toThrow('Budget details not found');
  });

  it('attaches lines, approvals, and versions to the budget', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: BUDGET_ID, name: 'Q1' }])
      .mockResolvedValueOnce([{ id: 'line-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'version-1' }]);

    const result = await getBudgetDetails(TENANT_ID, BUDGET_ID);

    expect(result.lines).toEqual([{ id: 'line-1' }]);
    expect(result.approvals).toEqual([]);
    expect(result.versions).toEqual([{ id: 'version-1' }]);
  });
});
