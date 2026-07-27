/**
 * Veridact — Unit Tests: MCP Interceptor
 *
 * Exercises the full Boundary → Policy → HITL pipeline together.
 */

import { describe, it, expect } from 'vitest';
import { interceptAction, MissingApproverError } from '../../src/engines/mcpInterceptor';
import { getApproval } from '../../src/engines/hitlStore';
import type { CoverageBoundary } from '../../src/types/boundary';
import type { PolicyBundle } from '../../src/types/policy';

const boundary: CoverageBoundary = {
  boundary_id: 'interceptor-test-boundary',
  tenant_id: 'tenant-interceptor',
  description: 'Support agent boundary',
  allowed_actions: ['revoke_api_key', 'transfer_to_human'],
  allowed_resource_patterns: ['customer:*'],
};

const policyBundle: PolicyBundle = {
  rules_version: 'interceptor-test-v1',
  rules_hash: 'irrelevant-for-these-tests',
  default_effect: 'DENY',
  rules: [
    {
      rule_id: 'deny-high-risk',
      description: 'Deny revoking keys for admin accounts outright',
      priority: 1,
      conditions: [{ field: 'account_type', operator: 'eq', value: 'admin' }],
      effect: 'DENY',
      reason: 'Revoking admin account keys is never permitted via this path.',
    },
    {
      rule_id: 'allow-revoke-with-hitl',
      description: 'Allow key revocation for standard accounts, but require approval',
      priority: 2,
      conditions: [{ field: 'action', operator: 'eq', value: 'revoke_api_key' }],
      effect: 'ALLOW',
      requires_hitl: true,
      reason: 'Key revocation requires human sign-off.',
    },
    {
      rule_id: 'allow-transfer',
      description: 'Allow transfers to a human with no additional approval',
      priority: 3,
      conditions: [{ field: 'action', operator: 'eq', value: 'transfer_to_human' }],
      effect: 'ALLOW',
      reason: 'Transfers to a human are always permitted.',
    },
  ],
};

describe('interceptAction', () => {
  it('denies at the boundary before policy ever runs', () => {
    const result = interceptAction({
      tenantId: 'tenant-interceptor',
      action: { action: 'delete_account', resource_id: 'customer:1', params: {} },
      boundary,
      policyBundle,
    });
    expect(result.outcome).toBe('DENIED');
    expect(result.boundary_decision.decision).toBe('DENY');
    expect(result.policy_decision).toBeNull();
  });

  it('denies via policy when boundary passes but a DENY rule matches', () => {
    const result = interceptAction({
      tenantId: 'tenant-interceptor',
      action: {
        action: 'revoke_api_key',
        resource_id: 'customer:1',
        params: { account_type: 'admin' },
      },
      boundary,
      policyBundle,
    });
    expect(result.outcome).toBe('DENIED');
    expect(result.boundary_decision.decision).toBe('ALLOW');
    expect(result.policy_decision?.decision).toBe('DENY');
    expect(result.policy_decision?.matched_rule_id).toBe('deny-high-risk');
  });

  it('goes to PENDING_HITL when policy allows but requires_hitl is set', () => {
    const result = interceptAction({
      tenantId: 'tenant-interceptor',
      action: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      boundary,
      policyBundle,
      assignedApproverId: 'approver-1',
    });
    expect(result.outcome).toBe('PENDING_HITL');
    expect(result.approval_id).not.toBeNull();

    const approval = getApproval(result.approval_id!, 'tenant-interceptor');
    expect(approval.status).toBe('PENDING');
    expect(approval.assigned_approver_id).toBe('approver-1');
  });

  it('throws MissingApproverError when HITL is required but no approver is given', () => {
    expect(() =>
      interceptAction({
        tenantId: 'tenant-interceptor',
        action: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
        boundary,
        policyBundle,
      })
    ).toThrow(MissingApproverError);
  });

  it('goes straight to ALLOWED when the matched rule does not require HITL', () => {
    const result = interceptAction({
      tenantId: 'tenant-interceptor',
      action: { action: 'transfer_to_human', resource_id: 'customer:1', params: {} },
      boundary,
      policyBundle,
    });
    expect(result.outcome).toBe('ALLOWED');
    expect(result.approval_id).toBeNull();
  });

  it('denies fail-closed when nothing matches (default_effect)', () => {
    const noMatchBundle: PolicyBundle = {
      ...policyBundle,
      rules: [],
    };
    const result = interceptAction({
      tenantId: 'tenant-interceptor',
      action: { action: 'transfer_to_human', resource_id: 'customer:1', params: {} },
      boundary,
      policyBundle: noMatchBundle,
    });
    expect(result.outcome).toBe('DENIED');
    expect(result.policy_decision?.matched_rule_id).toBeNull();
  });
});
