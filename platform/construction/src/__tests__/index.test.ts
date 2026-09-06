import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import {
  createProject,
  addCostItem,
  createChangeOrder,
  approveChangeOrder,
  getWipReport,
} from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MANAGER_ID = '22222222-2222-2222-2222-222222222222';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const CO_ID = '44444444-4444-4444-4444-444444444444';
const APPROVER_ID = '55555555-5555-5555-5555-555555555555';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createProject', () => {
  it('blocks when construction is disabled', async () => {
    mockConfig({ enabled: false, tiers: {}, limits: { projectCount: 25 } });
    await expect(createProject(TENANT_ID, { client_name: 'Acme' }, MANAGER_ID)).rejects.toThrow(
      'Construction disabled'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('enforces the project count limit', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { projectCount: 2 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '2' }]);
    await expect(createProject(TENANT_ID, { client_name: 'Acme' }, MANAGER_ID)).rejects.toThrow('Project limit reached');
  });

  it('generates a sequential job_number in YYYY-### format', async () => {
    mockConfig({ enabled: true, tiers: {}, limits: { projectCount: 25 } });
    const year = new Date().getFullYear();
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ seq: '4' }])
      .mockResolvedValueOnce([{ id: PROJECT_ID }]);

    await createProject(TENANT_ID, { client_name: 'Acme' }, MANAGER_ID);

    const insertParams = (withTenantQuery as any).mock.calls[2][1];
    expect(insertParams[2]).toBe(`${year}-005`);
  });
});

describe('addCostItem', () => {
  it('computes total_cents from quantity * unit_cost_cents', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'cost-1', total_cents: 5000 }]).mockResolvedValueOnce([]);

    await addCostItem(
      TENANT_ID,
      PROJECT_ID,
      { category: 'materials', description: 'Lumber', quantity: 10, unit_cost_cents: 500 },
      MANAGER_ID
    );

    const insertParams = (withTenantQuery as any).mock.calls[0][1];
    expect(insertParams[9]).toBe(5000);
  });

  it('defaults quantity to 1 when not provided', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'cost-1' }]).mockResolvedValueOnce([]);
    await addCostItem(TENANT_ID, PROJECT_ID, { category: 'materials', description: 'Nails', unit_cost_cents: 250 }, MANAGER_ID);
    const insertParams = (withTenantQuery as any).mock.calls[0][1];
    expect(insertParams[9]).toBe(250);
  });

  it('rolls the cost up into the project\'s running cost_cents total', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'cost-1' }]).mockResolvedValueOnce([]);
    await addCostItem(TENANT_ID, PROJECT_ID, { category: 'materials', description: 'x', quantity: 2, unit_cost_cents: 100 }, MANAGER_ID);
    const updateParams = (withTenantQuery as any).mock.calls[1][1];
    expect(updateParams[0]).toBe(200);
    expect(updateParams[1]).toBe(PROJECT_ID);
  });
});

describe('createChangeOrder', () => {
  // GAP — documented, not hidden. co_number is a random 4-digit string with
  // no query against existing change orders for uniqueness, unlike
  // createProject's job_number which does a real sequential COUNT. Two
  // change orders can collide with no retry or detection.
  it('GAP: co_number has no uniqueness check against existing change orders', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: CO_ID, co_number: 'CO-1234' }]);
    await createChangeOrder(TENANT_ID, PROJECT_ID, { title: 'Add deck', amount_cents: 500000 });
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
    // TODO(construction): either add a uniqueness check + retry, or rely on a
    // DB unique constraint and handle the collision explicitly.
  });

  it('creates a change order in pending status', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: CO_ID, status: 'pending' }]);
    const result = await createChangeOrder(TENANT_ID, PROJECT_ID, { title: 'Add deck', amount_cents: 500000 });
    expect(result.status).toBe('pending');
  });
});

describe('approveChangeOrder', () => {
  it('blocks when the changeOrders tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { changeOrders: false }, limits: {} });
    await expect(approveChangeOrder(TENANT_ID, CO_ID, APPROVER_ID)).rejects.toThrow('Change orders disabled');
  });

  it('throws NOT_FOUND when the change order does not exist', async () => {
    mockConfig({ enabled: true, tiers: { changeOrders: true }, limits: {} });
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(approveChangeOrder(TENANT_ID, CO_ID, APPROVER_ID)).rejects.toThrow('Change order not found');
  });

  it('rejects re-approving an already-approved change order', async () => {
    mockConfig({ enabled: true, tiers: { changeOrders: true }, limits: {} });
    (withTenantQuery as any).mockResolvedValueOnce([{ status: 'approved' }]);
    await expect(approveChangeOrder(TENANT_ID, CO_ID, APPROVER_ID)).rejects.toThrow('Already approved');
  });

  // BUG — documented, not hidden. The returned field is named
  // updated_contract_cents, implying it's the project's new total contract
  // value, but it's actually just the change order's own amount_cents (the
  // delta), not contract_cents + amount_cents.
  it('BUG: "updated_contract_cents" in the return value is actually just the CO delta, not the new total', async () => {
    mockConfig({ enabled: true, tiers: { changeOrders: true }, limits: {} });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: CO_ID, status: 'pending', amount_cents: 50000, project_id: PROJECT_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await approveChangeOrder(TENANT_ID, CO_ID, APPROVER_ID);

    expect(result.updated_contract_cents).toBe(50000);
    // TODO(construction): either rename this field to `contract_delta_cents`,
    // or actually return the project's post-update contract_cents value.
  });
});

describe('getWipReport', () => {
  it('returns rows with percent_billed computed by the query', async () => {
    const rows = [{ id: PROJECT_ID, percent_billed: '42.50' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const result = await getWipReport(TENANT_ID);
    expect(result).toEqual(rows);
  });
});
