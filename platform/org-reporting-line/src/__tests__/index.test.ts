import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      maxChainDepth: 20,
      allowSelfManage: false,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  upsertEmployeeNode,
  getManagerChain,
  getDirectReports,
  resolveApprover,
  assertIsManagerOf,
  __resetOrgReportingStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('org-reporting-line', () => {
  beforeEach(() => {
    __resetOrgReportingStore();
    vi.clearAllMocks();
  });

  it('builds chain CEO → mgr → emp', async () => {
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'ceo',
      managerId: null,
      title: 'CEO',
    });
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'mgr',
      managerId: 'ceo',
      title: 'Manager',
    });
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'emp',
      managerId: 'mgr',
      title: 'IC',
    });
    const chain = await getManagerChain(tenantId, actorId, 'emp');
    expect(chain).toEqual(['mgr', 'ceo']);
    const reports = await getDirectReports(tenantId, actorId, 'mgr');
    expect(reports.map((r) => r.employeeId)).toContain('emp');
  });

  it('resolves approver one level up', async () => {
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'mgr',
      managerId: null,
    });
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'emp',
      managerId: 'mgr',
    });
    const result = await resolveApprover(tenantId, actorId, 'emp', 1);
    expect(result.approverId).toBe('mgr');
    await assertIsManagerOf(tenantId, 'mgr', 'emp');
  });

  it('rejects cycles and self-manage', async () => {
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'a',
      managerId: null,
    });
    await upsertEmployeeNode(tenantId, actorId, {
      employeeId: 'b',
      managerId: 'a',
    });
    await expect(
      upsertEmployeeNode(tenantId, actorId, {
        employeeId: 'a',
        managerId: 'b',
      }),
    ).rejects.toThrow(/cycle/i);
    await expect(
      upsertEmployeeNode(tenantId, actorId, {
        employeeId: 'x',
        managerId: 'x',
      }),
    ).rejects.toThrow(/self/i);
  });
});
