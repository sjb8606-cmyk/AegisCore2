/**
 * Veridact — Unit Tests: Coverage Boundary Store (DB-backed)
 */

import { describe, it, expect } from 'vitest';
import {
  getBoundary,
  registerBoundary,
  listBoundariesForTenant,
  BoundaryNotFoundError,
} from '../../src/engines/boundaryStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('boundaryStore (DB-backed)', () => {
  it('registers a boundary and retrieves it by id + tenant', async () => {
    const registered = await registerBoundary({
      boundary_id: 'store-test-boundary-1',
      tenant_id: TENANT_A,
      description: 'Test boundary',
      allowed_actions: ['transfer_to_human'],
      allowed_resource_patterns: ['customer:*'],
    });
    expect(registered.boundary_id).toBe('store-test-boundary-1');

    const fetched = await getBoundary('store-test-boundary-1', TENANT_A);
    expect(fetched.tenant_id).toBe(TENANT_A);
    expect(fetched.allowed_actions).toContain('transfer_to_human');
  });

  it('throws BoundaryNotFoundError for an unknown boundary_id', async () => {
    await expect(getBoundary('nonexistent-boundary-xyz', TENANT_A)).rejects.toThrow(
      BoundaryNotFoundError
    );
  });

  it('RLS makes a boundary invisible under a different tenant — throws BoundaryNotFoundError, not a mismatch error', async () => {
    await registerBoundary({
      boundary_id: 'store-test-boundary-2',
      tenant_id: TENANT_A,
      description: 'Owned by tenant A only',
      allowed_actions: [],
      allowed_resource_patterns: [],
    });

    await expect(getBoundary('store-test-boundary-2', TENANT_B)).rejects.toThrow(
      BoundaryNotFoundError
    );
  });

  it('registerBoundary upserts on re-registration rather than erroring', async () => {
    await registerBoundary({
      boundary_id: 'store-test-boundary-3',
      tenant_id: TENANT_A,
      description: 'Original description',
      allowed_actions: ['action_a'],
      allowed_resource_patterns: ['*'],
    });

    const updated = await registerBoundary({
      boundary_id: 'store-test-boundary-3',
      tenant_id: TENANT_A,
      description: 'Updated description',
      allowed_actions: ['action_a', 'action_b'],
      allowed_resource_patterns: ['*'],
    });

    expect(updated.description).toBe('Updated description');
    expect(updated.allowed_actions).toContain('action_b');
  });

  it('field_constraints and require_all_params_constrained round-trip correctly', async () => {
    await registerBoundary({
      boundary_id: 'store-test-boundary-4',
      tenant_id: TENANT_A,
      description: 'With constraints',
      allowed_actions: ['revoke_api_key'],
      allowed_resource_patterns: ['customer:*'],
      field_constraints: {
        severity: { allowed_values: ['low', 'medium', 'high'] },
      },
      require_all_params_constrained: true,
    });

    const fetched = await getBoundary('store-test-boundary-4', TENANT_A);
    expect(fetched.field_constraints?.severity?.allowed_values).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(fetched.require_all_params_constrained).toBe(true);
  });

  it('listBoundariesForTenant only returns boundaries owned by that tenant', async () => {
    await registerBoundary({
      boundary_id: 'store-test-boundary-5a',
      tenant_id: TENANT_A,
      description: 'A',
      allowed_actions: [],
      allowed_resource_patterns: [],
    });
    await registerBoundary({
      boundary_id: 'store-test-boundary-5b',
      tenant_id: TENANT_B,
      description: 'B',
      allowed_actions: [],
      allowed_resource_patterns: [],
    });

    const tenantAList = await listBoundariesForTenant(TENANT_A);
    expect(tenantAList.some((b) => b.boundary_id === 'store-test-boundary-5a')).toBe(true);
    expect(tenantAList.some((b) => b.boundary_id === 'store-test-boundary-5b')).toBe(false);
  });
});
