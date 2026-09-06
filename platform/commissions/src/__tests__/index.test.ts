import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import {
  createCommissionPlan,
  createCommissionRule,
  calculateCommissions,
  processPayoutBatch,
  getCommissionsLogs,
} from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_AGENT_ID = '33333333-3333-3333-3333-333333333333';
const TX_ID = '44444444-4444-4444-4444-444444444444';
const PLAN_ID = '55555555-5555-5555-5555-555555555555';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createCommissionPlan', () => {
  it('blocks when the vertical is disabled', async () => {
    mockConfig({ enabled: false, tiers: {}, limits: { commissionPlans: 10 } });
    await expect(createCommissionPlan(TENANT_ID, AGENT_ID, { name: 'Standard' })).rejects.toThrow(
      'Commissions vertical is disabled'
    );
  });

  it('enforces the plan count limit', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { commissionPlans: 1 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '1' }]);
    await expect(createCommissionPlan(TENANT_ID, AGENT_ID, { name: 'Standard' })).rejects.toThrow(
      'Commission plan limits reached'
    );
  });
});

describe('calculateCommissions', () => {
  it('throws when no active rules exist at all', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(
      calculateCommissions(TENANT_ID, { transactionId: TX_ID, revenueAmount: 10000, agentId: AGENT_ID, sourceType: 'sale' })
    ).rejects.toThrow('No active commission plans or rules configured');
  });

  it('computes commission_amount_cents correctly from rate_percent', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'rule-1', plan_id: PLAN_ID, rate_percent: '10' }])
      .mockResolvedValueOnce([{ id: 'rec-1', commission_amount_cents: 1000 }]);

    await calculateCommissions(TENANT_ID, {
      transactionId: TX_ID,
      revenueAmount: 10000,
      agentId: AGENT_ID,
      sourceType: 'sale',
    });

    const insertParams = (withTenantQuery as any).mock.calls[1][1];
    expect(insertParams[6]).toBe(1000); // 10% of 10000 = 1000
  });

  // BUG — documented, not hidden. There is no lookup anywhere in this file
  // linking agentId to a specific plan_id. calculateCommissions fetches every
  // active rule from every active plan tenant-wide and applies ALL of them
  // to every transaction, regardless of which plan the agent is actually on.
  it('BUG: applies rules from ALL active plans tenant-wide, not just the agent\'s own plan', async () => {
    const ruleFromPlanA = { id: 'rule-a', plan_id: 'plan-a', rate_percent: '5' };
    const ruleFromPlanB = { id: 'rule-b', plan_id: 'plan-b', rate_percent: '15' }; // a DIFFERENT plan
    (withTenantQuery as any)
      .mockResolvedValueOnce([ruleFromPlanA, ruleFromPlanB]) // both returned with no plan/agent filter
      .mockResolvedValueOnce([{ id: 'rec-a' }])
      .mockResolvedValueOnce([{ id: 'rec-b' }]);

    const result = await calculateCommissions(TENANT_ID, {
      transactionId: TX_ID,
      revenueAmount: 10000,
      agentId: AGENT_ID, // this agent may only be enrolled in plan-a, not plan-b
      sourceType: 'sale',
    });

    expect(result).toHaveLength(2); // one commission record per rule, from BOTH unrelated plans
    // TODO(commissions launch blocker): join against an agent-to-plan assignment
    // table and only apply rules from the agent's own active plan(s).
  });
});

describe('processPayoutBatch', () => {
  it('pays out and marks paid every pending record for the tenant', async () => {
    const pendingRecords = [
      { id: 'rec-1', agent_id: AGENT_ID, commission_amount_cents: 500 },
      { id: 'rec-2', agent_id: OTHER_AGENT_ID, commission_amount_cents: 700 },
    ];
    (withTenantQuery as any)
      .mockResolvedValueOnce(pendingRecords)
      .mockResolvedValue([]);

    const result = await processPayoutBatch(TENANT_ID, 'batch-123');

    expect(result).toEqual({ success: true, records_processed: 2 });
  });

  // BUG — documented, not hidden. The SELECT that fetches pending records
  // has no WHERE clause referencing batchId at all — it grabs every
  // status='pending' record for the whole tenant. batchId is only used as a
  // label on the payout rows it inserts, never as a filter on what gets paid.
  it('BUG: batchId is never used to filter which records get paid — pays ALL pending records regardless', async () => {
    const unrelatedPendingRecord = { id: 'rec-unrelated', agent_id: OTHER_AGENT_ID, commission_amount_cents: 999999 };
    (withTenantQuery as any).mockResolvedValueOnce([unrelatedPendingRecord]).mockResolvedValue([]);

    const result = await processPayoutBatch(TENANT_ID, 'some-unrelated-batch-id');

    expect(result.records_processed).toBe(1); // paid out despite no real link to the batch requested
    const selectCallArgs = (withTenantQuery as any).mock.calls[0];
    expect(selectCallArgs[1]).toEqual([TENANT_ID]); // confirms: only tenantId is bound, batchId isn't even a query param
    // TODO(commissions launch blocker): scope the SELECT to records actually
    // belonging to batchId, or remove the parameter if batching isn't real yet.
  });
});

describe('getCommissionsLogs', () => {
  it('returns commission records for a transaction', async () => {
    const rows = [{ id: 'rec-1' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const result = await getCommissionsLogs(TENANT_ID, TX_ID);
    expect(result).toEqual(rows);
  });
});
