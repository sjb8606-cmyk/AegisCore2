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
      defaultTasks: [
        { key: 'revoke_access', label: 'Revoke system access', required: true },
        { key: 'return_assets', label: 'Return company assets', required: true },
        { key: 'final_pay', label: 'Final pay processed', required: true },
        { key: 'exit_interview', label: 'Exit interview', required: false },
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
  openTermination,
  completeOffboardTask,
  closeTermination,
  assertAccessRevoked,
  __resetTerminationOffboardingStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const employeeId = 'emp-1';

describe('termination-offboarding', () => {
  beforeEach(() => {
    __resetTerminationOffboardingStore();
    vi.clearAllMocks();
  });

  it('blocks close until required tasks done', async () => {
    const c = await openTermination(tenantId, actorId, {
      employeeId,
      effectiveDate: '2026-12-01',
      reason: 'resignation',
    });
    await expect(closeTermination(tenantId, actorId, c.id)).rejects.toThrow(
      /incomplete/i,
    );
  });

  it('completes full offboarding path', async () => {
    const c = await openTermination(tenantId, actorId, {
      employeeId,
      effectiveDate: '2026-12-01',
    });
    await completeOffboardTask(tenantId, actorId, c.id, 'revoke_access');
    await completeOffboardTask(tenantId, actorId, c.id, 'return_assets');
    await completeOffboardTask(tenantId, actorId, c.id, 'final_pay');
    const closed = await closeTermination(tenantId, actorId, c.id);
    expect(closed.status).toBe('completed');
    expect(closed.accessRevoked).toBe(true);
    expect(closed.finalPayReady).toBe(true);
    const gate = await assertAccessRevoked(tenantId, employeeId);
    expect(gate.revoked).toBe(true);
  });

  it('assertAccessRevoked fails before revoke task', async () => {
    await openTermination(tenantId, actorId, {
      employeeId,
      effectiveDate: '2026-12-15',
    });
    await expect(assertAccessRevoked(tenantId, employeeId)).rejects.toThrow(
      /not yet revoked/i,
    );
  });
});
