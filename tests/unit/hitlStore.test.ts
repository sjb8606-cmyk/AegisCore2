/**
 * Veridact — Unit Tests: HITL Approval Store
 */

import { describe, it, expect } from 'vitest';
import {
  createApproval,
  getApproval,
  resolveApprovalById,
  listPendingForApprover,
  ApprovalNotFoundError,
  ApprovalTenantMismatchError,
} from '../../src/engines/hitlStore';

describe('hitlStore', () => {
  it('creates and retrieves an approval by id + tenant', () => {
    const created = createApproval({
      tenantId: 'store-tenant-1',
      proposedAction: { action: 'transfer_to_human', resource_id: 'department:Billing', params: {} },
      assignedApproverId: 'approver-A',
      reason: 'Escalation requires sign-off.',
      ttlSeconds: 300,
    });

    const fetched = getApproval(created.approval_id, 'store-tenant-1');
    expect(fetched.approval_id).toBe(created.approval_id);
    expect(fetched.status).toBe('PENDING');
  });

  it('throws ApprovalNotFoundError for unknown approval_id', () => {
    expect(() => getApproval('nonexistent-id', 'store-tenant-1')).toThrow(ApprovalNotFoundError);
  });

  it('throws ApprovalTenantMismatchError when tenant does not own the approval', () => {
    const created = createApproval({
      tenantId: 'store-tenant-2',
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-B',
      reason: 'test',
      ttlSeconds: 300,
    });
    expect(() => getApproval(created.approval_id, 'some-other-tenant')).toThrow(
      ApprovalTenantMismatchError
    );
  });

  it('resolveApprovalById updates and persists the resolution', () => {
    const created = createApproval({
      tenantId: 'store-tenant-3',
      proposedAction: { action: 'disable_user_access', resource_id: 'user:1', params: {} },
      assignedApproverId: 'approver-C',
      reason: 'test',
      ttlSeconds: 300,
    });

    const resolved = resolveApprovalById(
      created.approval_id,
      'store-tenant-3',
      'approver-C',
      'APPROVED',
      'confirmed by phone'
    );
    expect(resolved.status).toBe('APPROVED');

    const refetched = getApproval(created.approval_id, 'store-tenant-3');
    expect(refetched.status).toBe('APPROVED');
    expect(refetched.resolution_note).toBe('confirmed by phone');
  });

  it("listPendingForApprover only returns that approver's pending items in that tenant", () => {
    createApproval({
      tenantId: 'store-tenant-4',
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-D',
      reason: 'test',
      ttlSeconds: 300,
    });
    createApproval({
      tenantId: 'store-tenant-4',
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:2', params: {} },
      assignedApproverId: 'approver-E',
      reason: 'test',
      ttlSeconds: 300,
    });

    const pendingForD = listPendingForApprover('approver-D', 'store-tenant-4');
    expect(pendingForD).toHaveLength(1);
    expect(pendingForD[0].assigned_approver_id).toBe('approver-D');
  });

  it('listPendingForApprover excludes already-resolved approvals', () => {
    const created = createApproval({
      tenantId: 'store-tenant-5',
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-F',
      reason: 'test',
      ttlSeconds: 300,
    });
    resolveApprovalById(created.approval_id, 'store-tenant-5', 'approver-F', 'REJECTED');

    const pending = listPendingForApprover('approver-F', 'store-tenant-5');
    expect(pending).toHaveLength(0);
  });
});
