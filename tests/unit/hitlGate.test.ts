/**
 * Veridact — Unit Tests: HITL Gate Engine
 */

import { describe, it, expect } from 'vitest';
import {
  createPendingApproval,
  resolveApproval,
  getEffectiveStatus,
  isActionAuthorized,
  ApprovalAlreadyResolvedError,
  ApprovalExpiredError,
  UnauthorizedApproverError,
} from '../../src/engines/hitlGate';
import type { CreateApprovalParams } from '../../src/types/hitl';

const NOW = new Date('2026-07-27T12:00:00.000Z');

const baseParams: CreateApprovalParams = {
  tenantId: 'tenant-1',
  proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
  assignedApproverId: 'approver-1',
  reason: 'High-severity action requires human sign-off.',
  ttlSeconds: 3600,
};

describe('createPendingApproval', () => {
  it('creates an approval with status PENDING', () => {
    const approval = createPendingApproval(baseParams, NOW);
    expect(approval.status).toBe('PENDING');
    expect(approval.assigned_approver_id).toBe('approver-1');
  });

  it('sets expires_at correctly based on ttlSeconds', () => {
    const approval = createPendingApproval(baseParams, NOW);
    expect(approval.expires_at).toBe('2026-07-27T13:00:00.000Z');
  });
});

describe('getEffectiveStatus', () => {
  it('returns PENDING before expiry', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const oneMinuteLater = new Date(NOW.getTime() + 60_000);
    expect(getEffectiveStatus(approval, oneMinuteLater).status).toBe('PENDING');
  });

  it('returns EXPIRED after expires_at, without mutating the input', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const wayLater = new Date(NOW.getTime() + 999_999_999);
    const result = getEffectiveStatus(approval, wayLater);
    expect(result.status).toBe('EXPIRED');
    expect(approval.status).toBe('PENDING');
  });

  it('returns the terminal status as-is once already resolved (does not re-expire)', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'APPROVED', undefined, NOW);
    const wayLater = new Date(NOW.getTime() + 999_999_999);
    expect(getEffectiveStatus(resolved, wayLater).status).toBe('APPROVED');
  });
});

describe('resolveApproval', () => {
  it('resolves to APPROVED by the assigned approver', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'APPROVED', 'looks fine', NOW);
    expect(resolved.status).toBe('APPROVED');
    expect(resolved.resolved_by).toBe('approver-1');
    expect(resolved.resolution_note).toBe('looks fine');
  });

  it('resolves to REJECTED by the assigned approver', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'REJECTED', 'not authorized', NOW);
    expect(resolved.status).toBe('REJECTED');
  });

  it('throws UnauthorizedApproverError if resolver is not the assigned approver', () => {
    const approval = createPendingApproval(baseParams, NOW);
    expect(() => resolveApproval(approval, 'someone-else', 'APPROVED', undefined, NOW)).toThrow(
      UnauthorizedApproverError
    );
  });

  it('throws ApprovalAlreadyResolvedError on a second resolve attempt', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'APPROVED', undefined, NOW);
    expect(() => resolveApproval(resolved, 'approver-1', 'REJECTED', undefined, NOW)).toThrow(
      ApprovalAlreadyResolvedError
    );
  });

  it('throws ApprovalExpiredError when resolving after expiry', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const wayLater = new Date(NOW.getTime() + 999_999_999);
    expect(() =>
      resolveApproval(approval, 'approver-1', 'APPROVED', undefined, wayLater)
    ).toThrow(ApprovalExpiredError);
  });
});

describe('isActionAuthorized', () => {
  it('returns false while PENDING', () => {
    const approval = createPendingApproval(baseParams, NOW);
    expect(isActionAuthorized(approval, NOW)).toBe(false);
  });

  it('returns true once APPROVED', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'APPROVED', undefined, NOW);
    expect(isActionAuthorized(resolved, NOW)).toBe(true);
  });

  it('returns false when REJECTED', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const resolved = resolveApproval(approval, 'approver-1', 'REJECTED', undefined, NOW);
    expect(isActionAuthorized(resolved, NOW)).toBe(false);
  });

  it('returns false for an expired approval, even though it was never explicitly rejected', () => {
    const approval = createPendingApproval(baseParams, NOW);
    const wayLater = new Date(NOW.getTime() + 999_999_999);
    expect(isActionAuthorized(approval, wayLater)).toBe(false);
  });
});
