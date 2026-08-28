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
      allowNegativeBalance: false,
      defaultAnnualAccrualDays: 15,
      leaveTypes: ['pto', 'sick', 'unpaid'],
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
  setBalance,
  accrueLeave,
  requestLeave,
  approveLeave,
  rejectLeave,
  getBalanceForEmployee,
  __resetLeaveBalanceStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const employeeId = 'emp-1';

describe('leave-balance-engine', () => {
  beforeEach(() => {
    __resetLeaveBalanceStore();
    vi.clearAllMocks();
  });

  it('accrues and approves leave deducting balance', async () => {
    await setBalance(tenantId, actorId, {
      employeeId,
      leaveType: 'pto',
      balanceDays: 10,
    });
    await accrueLeave(tenantId, actorId, {
      employeeId,
      leaveType: 'pto',
      days: 2,
    });
    const req = await requestLeave(tenantId, actorId, {
      employeeId,
      leaveType: 'pto',
      startDate: '2026-10-01',
      endDate: '2026-10-03',
    });
    expect(req.days).toBe(3);
    await approveLeave(tenantId, actorId, req.id);
    const bal = await getBalanceForEmployee(tenantId, actorId, employeeId, 'pto');
    expect(bal.balanceDays).toBe(9); // 12 - 3
  });

  it('blocks request when insufficient balance', async () => {
    await setBalance(tenantId, actorId, {
      employeeId,
      leaveType: 'sick',
      balanceDays: 1,
    });
    await expect(
      requestLeave(tenantId, actorId, {
        employeeId,
        leaveType: 'sick',
        startDate: '2026-10-01',
        endDate: '2026-10-05',
      }),
    ).rejects.toThrow(/insufficient/i);
  });

  it('allows unpaid without balance and supports reject', async () => {
    const req = await requestLeave(tenantId, actorId, {
      employeeId,
      leaveType: 'unpaid',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
    const rejected = await rejectLeave(tenantId, actorId, req.id);
    expect(rejected.status).toBe('rejected');
  });
});
