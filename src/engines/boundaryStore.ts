/**
 * Veridact — Coverage Boundary Store (DB-backed)
 *
 * Persists CoverageBoundaries to the coverage_boundaries table, RLS-scoped
 * by tenant via withTenant(). Replaces the earlier in-memory Map.
 *
 * IMPORTANT RLS BEHAVIOR CHANGE from the in-memory version: previously,
 * looking up a boundary_id that belonged to a different tenant threw a
 * distinct BoundaryTenantMismatchError. Under real Postgres RLS, a query
 * scoped to tenant A can never see tenant B's rows at all — the database
 * filters them out before the application ever sees them. So a mismatched
 * boundary_id and a genuinely nonexistent one are now indistinguishable:
 * both simply return zero rows, and both throw BoundaryNotFoundError.
 * BoundaryTenantMismatchError is kept exported for compatibility but is
 * unreachable through this store's normal (RLS-scoped) access path.
 */

import { withTenant } from '../db/client';
import type { CoverageBoundary } from '../types/boundary';

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

function rowToBoundary(row: Record<string, unknown>): CoverageBoundary {
  return {
    boundary_id: row.boundary_id as string,
    tenant_id: row.tenant_id as string,
    description: row.description as string,
    allowed_actions: row.allowed_actions as string[],
    allowed_resource_patterns: row.allowed_resource_patterns as string[],
    field_constraints: (row.field_constraints ?? undefined) as CoverageBoundary['field_constraints'],
    require_all_params_constrained: row.require_all_params_constrained as boolean,
  };
}

export async function registerBoundary(boundary: CoverageBoundary): Promise<CoverageBoundary> {
  return withTenant(boundary.tenant_id, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO coverage_boundaries (
        boundary_id, tenant_id, description, allowed_actions,
        allowed_resource_patterns, field_constraints, require_all_params_constrained
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (boundary_id)
      DO UPDATE SET
        description = EXCLUDED.description,
        allowed_actions = EXCLUDED.allowed_actions,
        allowed_resource_patterns = EXCLUDED.allowed_resource_patterns,
        field_constraints = EXCLUDED.field_constraints,
        require_all_params_constrained = EXCLUDED.require_all_params_constrained,
        deleted_at = NULL
      RETURNING boundary_id, tenant_id, description, allowed_actions,
                allowed_resource_patterns, field_constraints, require_all_params_constrained`,
      [
        boundary.boundary_id,
        boundary.tenant_id,
        boundary.description,
        JSON.stringify(boundary.allowed_actions),
        JSON.stringify(boundary.allowed_resource_patterns),
        boundary.field_constraints ? JSON.stringify(boundary.field_constraints) : null,
        boundary.require_all_params_constrained ?? false,
      ]
    );
    return rowToBoundary(res.rows[0]);
  });
}

export async function getBoundary(boundaryId: string, tenantId: string): Promise<CoverageBoundary> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT boundary_id, tenant_id, description, allowed_actions,
              allowed_resource_patterns, field_constraints, require_all_params_constrained
       FROM coverage_boundaries
       WHERE boundary_id = $1 AND deleted_at IS NULL`,
      [boundaryId]
    );

    if (res.rows.length === 0) {
      throw new BoundaryNotFoundError(boundaryId);
    }

    return rowToBoundary(res.rows[0]);
  });
}

export async function listBoundariesForTenant(tenantId: string): Promise<CoverageBoundary[]> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT boundary_id, tenant_id, description, allowed_actions,
              allowed_resource_patterns, field_constraints, require_all_params_constrained
       FROM coverage_boundaries
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    return res.rows.map(rowToBoundary);
  });
}
