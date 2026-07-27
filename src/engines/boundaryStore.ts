/**
 * Veridact — Coverage Boundary Store
 *
 * In-memory registry of CoverageBoundaries, keyed by boundary_id.
 * Each tenant may register one or more boundaries; a boundary itself is
 * authorized by a human at creation time (per Veridact's "no silent
 * automation" principle) — this store just holds the already-authorized set.
 *
 * SWAP: replace with a DB-backed loader once boundaries are created via
 * the questionnaire → skin compiler instead of registered in code.
 */

import type { CoverageBoundary } from '../types/boundary';

const BOUNDARIES = new Map<string, CoverageBoundary>();

export class BoundaryNotFoundError extends Error {
  statusCode = 400;
  constructor(boundaryId: string) {
    super(`No coverage boundary registered with boundary_id "${boundaryId}"`);
    this.name = 'BoundaryNotFoundError';
  }
}

export class BoundaryTenantMismatchError extends Error {
  statusCode = 403;
  constructor(boundaryId: string, tenantId: string) {
    super(`Boundary "${boundaryId}" does not belong to tenant "${tenantId}"`);
    this.name = 'BoundaryTenantMismatchError';
  }
}

export function registerBoundary(boundary: CoverageBoundary): CoverageBoundary {
  BOUNDARIES.set(boundary.boundary_id, boundary);
  return boundary;
}

export function getBoundary(boundaryId: string, tenantId: string): CoverageBoundary {
  const boundary = BOUNDARIES.get(boundaryId);
  if (!boundary) {
    throw new BoundaryNotFoundError(boundaryId);
  }
  if (boundary.tenant_id !== tenantId) {
    throw new BoundaryTenantMismatchError(boundaryId, tenantId);
  }
  return boundary;
}

export function listBoundariesForTenant(tenantId: string): CoverageBoundary[] {
  return Array.from(BOUNDARIES.values()).filter((b) => b.tenant_id === tenantId);
}

// ─── Default / example boundary ────────────────────────────────────────────
registerBoundary({
  boundary_id: 'default-support-boundary',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  description: 'Default example boundary for a support/service-desk agent.',
  allowed_actions: ['revoke_api_key', 'disable_user_access', 'create_incident_record', 'transfer_to_human'],
  allowed_resource_patterns: ['customer:*', 'user:*', 'incident:*'],
  field_constraints: {
    severity: { allowed_values: ['low', 'medium', 'high'] },
  },
});
