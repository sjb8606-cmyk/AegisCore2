/**
 * Veridact — Unit Tests: HITL Approval Store (DB-backed)
 */

import { describe, it, expect } from 'vitest';
import {
  createApproval,
  getApproval,
  resolveApprovalById,
  listPendingForApprover,
  ApprovalNotFoundError,
} from '../../src/engines/hitlStore';

const TENANT_1 = '88888888-8888-8888-8888-888888888881';
const TENANT_2 = '88888888-8888-8888-8888-888888888882';
const TENANT_3 = '88888888-8888-8888-8888-888888888883';
const TENANT_4 = '88888888-8888-8888-8888-888888888884';
const TENANT_5 = '88888888-8888-8888-8888-888888888885';

describe('hitlStore (DB-backed)', () => {
  it('creates and retrieves an approval by id + tenant', async () => {
    const created = await createApproval({
      tenantId: TENANT_1,
      proposedAction: { action: 'transfer_to_human', resource_id: 'department:Billing', params: {} },
      assignedApproverId: 'approver-A',
      reason: 'Escalation requires sign-off.',
      ttlSeconds: 300,
    });

    const fetched = await getApproval(created.approval_id, TENANT_1);
    expect(fetched.approval_id).toBe(created.approval_id);
    expect(fetched.status).toBe('PENDING');
  });

  it('throws ApprovalNotFoundError for unknown approval_id', async () => {
    await expect(getApproval('00000000-0000-0000-0000-000000000000', TENANT_1)).rejects.toThrow(
      ApprovalNotFoundError
    );
  });

  it('RLS makes an approval invisible under a different tenant — throws ApprovalNotFoundError', async () => {
    const created = await createApproval({
      tenantId: TENANT_2,
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-B',
      reason: 'test',
      ttlSeconds: 300,
    });

    await expect(getApproval(created.approval_id, TENANT_3)).rejects.toThrow(ApprovalNotFoundError);
  });

  it('resolveApprovalById updates and persists the resolution', async () => {
    const created = await createApproval({
      tenantId: TENANT_3,
      proposedAction: { action: 'disable_user_access', resource_id: 'user:1', params: {} },
      assignedApproverId: 'approver-C',
      reason: 'test',
      ttlSeconds: 300,
    });

    const resolved = await resolveApprovalById(
      created.approval_id,
      TENANT_3,
      'approver-C',
      'APPROVED',
      'confirmed by phone'
    );
    expect(resolved.status).toBe('APPROVED');

    const refetched = await getApproval(created.approval_id, TENANT_3);
    expect(refetched.status).toBe('APPROVED');
    expect(refetched.resolution_note).toBe('confirmed by phone');
  });

  it("listPendingForApprover only returns that approver's pending items in that tenant", async () => {
    await createApproval({
      tenantId: TENANT_4,
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-D',
      reason: 'test',
      ttlSeconds: 300,
    });
    await createApproval({
      tenantId: TENANT_4,
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:2', params: {} },
      assignedApproverId: 'approver-E',
      reason: 'test',
      ttlSeconds: 300,
    });

    const pendingForD = await listPendingForApprover('approver-D', TENANT_4);
    expect(pendingForD).toHaveLength(1);
    expect(pendingForD[0].assigned_approver_id).toBe('approver-D');
  });

  it('listPendingForApprover excludes already-resolved approvals', async () => {
    const created = await createApproval({
      tenantId: TENANT_5,
      proposedAction: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assignedApproverId: 'approver-F',
      reason: 'test',
      ttlSeconds: 300,
    });
    await resolveApprovalById(created.approval_id, TENANT_5, 'approver-F', 'REJECTED');

    const pending = await listPendingForApprover('approver-F', TENANT_5);
    expect(pending).toHaveLength(0);
  });
});
