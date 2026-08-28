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
      blockWhenUnacked: true,
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
  publishPolicyVersion,
  acknowledgePolicy,
  assertPoliciesCurrent,
  getEmployeeAckStatus,
  __resetPolicyAckStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const employeeId = 'emp-1';

describe('policy-ack-tracker', () => {
  beforeEach(() => {
    __resetPolicyAckStore();
    vi.clearAllMocks();
  });

  it('blocks until required policy acked', async () => {
    await publishPolicyVersion(tenantId, actorId, {
      policyKey: 'handbook',
      version: '2026.1',
      title: 'Employee Handbook',
      bodyHash: 'hash1',
      required: true,
    });
    await expect(assertPoliciesCurrent(tenantId, employeeId)).rejects.toThrow(
      /unacknowledged/i,
    );
  });

  it('passes after acknowledge', async () => {
    const ver = await publishPolicyVersion(tenantId, actorId, {
      policyKey: 'safety',
      version: '1.0',
      title: 'Safety',
      bodyHash: 'h',
    });
    await acknowledgePolicy(tenantId, actorId, {
      employeeId,
      policyVersionId: ver.id,
    });
    const result = await assertPoliciesCurrent(tenantId, employeeId);
    expect(result.current).toBe(true);
  });

  it('requires re-ack when new version published', async () => {
    const v1 = await publishPolicyVersion(tenantId, actorId, {
      policyKey: 'handbook',
      version: '1',
      title: 'HB',
      bodyHash: 'a',
    });
    await acknowledgePolicy(tenantId, actorId, {
      employeeId,
      policyVersionId: v1.id,
    });
    await publishPolicyVersion(tenantId, actorId, {
      policyKey: 'handbook',
      version: '2',
      title: 'HB2',
      bodyHash: 'b',
    });
    const status = await getEmployeeAckStatus(tenantId, actorId, employeeId);
    expect(status.missing.some((m) => m.version === '2')).toBe(true);
    await expect(assertPoliciesCurrent(tenantId, employeeId)).rejects.toThrow(
      /handbook@2/,
    );
  });
});
