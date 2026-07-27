/**
 * Veridact — Unit Tests: Coverage Boundary Store
 */

import { describe, it, expect } from 'vitest';
import {
  getBoundary,
  registerBoundary,
  listBoundariesForTenant,
  BoundaryNotFoundError,
  BoundaryTenantMismatchError,
} from '../../src/engines/boundaryStore';

describe('boundaryStore', () => {
  it('returns the default boundary for its owning tenant', () => {
    const boundary = getBoundary(
      'default-support-boundary',
      '00000000-0000-0000-0000-000000000001'
    );
    expect(boundary.boundary_id).toBe('default-support-boundary');
  });

  it('throws BoundaryNotFoundError for an unknown boundary_id', () => {
    expect(() => getBoundary('nonexistent', 'tenant-1')).toThrow(BoundaryNotFoundError);
  });

  it('throws BoundaryTenantMismatchError when tenant does not own the boundary', () => {
    expect(() =>
      getBoundary('default-support-boundary', 'some-other-tenant')
    ).toThrow(BoundaryTenantMismatchError);
  });

  it('registerBoundary + getBoundary round-trips correctly', () => {
    registerBoundary({
      boundary_id: 'unit-test-boundary',
      tenant_id: 'tenant-xyz',
      description: 'Round-trip test',
      allowed_actions: ['transfer_to_human'],
      allowed_resource_patterns: ['*'],
    });

    const fetched = getBoundary('unit-test-boundary', 'tenant-xyz');
    expect(fetched.allowed_actions).toContain('transfer_to_human');
  });

  it('listBoundariesForTenant only returns boundaries owned by that tenant', () => {
    registerBoundary({
      boundary_id: 'tenant-a-boundary',
      tenant_id: 'tenant-a',
      description: 'A',
      allowed_actions: [],
      allowed_resource_patterns: [],
    });
    registerBoundary({
      boundary_id: 'tenant-b-boundary',
      tenant_id: 'tenant-b',
      description: 'B',
      allowed_actions: [],
      allowed_resource_patterns: [],
    });

    const tenantAList = listBoundariesForTenant('tenant-a');
    expect(tenantAList.some((b) => b.boundary_id === 'tenant-a-boundary')).toBe(true);
    expect(tenantAList.some((b) => b.boundary_id === 'tenant-b-boundary')).toBe(false);
  });
});
