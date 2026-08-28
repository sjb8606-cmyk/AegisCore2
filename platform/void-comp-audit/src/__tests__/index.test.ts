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
      requireManagerPin: true,
      requireReason: true,
      maxCompCentsWithoutDualAuth: 5000,
      reasonCodes: [
        'wrong_item',
        'quality',
        'guest_complaint',
        'staff_meal',
        'training',
        'other',
      ],
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
  recordVoid,
  recordComp,
  getShiftAdjustmentReport,
  setManagerPinVerifier,
  __resetVoidCompAuditStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const orderId = '00000000-0000-4000-8000-0000000000ee';
const shiftId = 'shift-1';

describe('void-comp-audit', () => {
  beforeEach(() => {
    __resetVoidCompAuditStore();
    vi.clearAllMocks();
    setManagerPinVerifier(async (_t, _m, pin) => pin === '1234');
  });

  it('records void with valid manager PIN', async () => {
    const event = await recordVoid(tenantId, actorId, {
      orderId,
      amountCents: 1500,
      reasonCode: 'wrong_item',
      serverId: 'server-1',
      managerId: 'mgr-1',
      managerPin: '1234',
      shiftId,
    });
    expect(event.type).toBe('void');
    expect(event.amountCents).toBe(1500);
  });

  it('rejects bad PIN and missing reason', async () => {
    await expect(
      recordComp(tenantId, actorId, {
        orderId,
        amountCents: 500,
        reasonCode: 'quality',
        serverId: 's1',
        managerId: 'm1',
        managerPin: '0000',
      }),
    ).rejects.toThrow(/pin/i);

    await expect(
      recordComp(tenantId, actorId, {
        orderId,
        amountCents: 500,
        reasonCode: '',
        serverId: 's1',
        managerId: 'm1',
        managerPin: '1234',
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('builds shift report totals', async () => {
    await recordVoid(tenantId, actorId, {
      orderId,
      amountCents: 1000,
      reasonCode: 'wrong_item',
      serverId: 's1',
      managerId: 'm1',
      managerPin: '1234',
      shiftId,
    });
    await recordComp(tenantId, actorId, {
      orderId,
      amountCents: 2500,
      reasonCode: 'guest_complaint',
      serverId: 's1',
      managerId: 'm1',
      managerPin: '1234',
      shiftId,
    });
    const report = await getShiftAdjustmentReport(tenantId, actorId, shiftId);
    expect(report.totalVoidCents).toBe(1000);
    expect(report.totalCompCents).toBe(2500);
    expect(report.voids).toHaveLength(1);
    expect(report.comps).toHaveLength(1);
  });
});
