import { Pool } from 'pg';
import { AppError, ErrorCode } from '../../utils/src/index';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    // Read from vault, fallback to local dev only if absolutely necessary
    const connectionString = process.env.DATABASE_URL || 'postgres://platform:changeme@localhost:5432/platform_core';
    
    _pool = new Pool({
      connectionString,
      max: 10,
    });
  }
  return _pool;
}

export async function withTenantTransaction(fn: (client: any) => Promise<any>, tenantId: string): Promise<any> {
  if (!tenantId) throw new AppError('Tenant ID Mandatory', ErrorCode.UNAUTHORIZED);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function withTenantQuery<T = any>(sql: string, params: any[], tenantId: string): Promise<T[]> {
  return withTenantTransaction(async (client) => {
    const result = await client.query(sql, params);
    return result.rows;
  }, tenantId);
}

// SWAP FIX: Veridact expects (tenantId, fn), we had (fn, tenantId)
export async function withTenant(tenantId: string, fn: (client: any) => Promise<any>): Promise<any> {
  return withTenantTransaction(fn, tenantId);
}

/**
 * Assert that a resource's tenantId matches the caller's verified tenantId.
 * Throws NOT_FOUND (not FORBIDDEN) on mismatch — deliberately vague, so a
 * cross-tenant probe can't distinguish "doesn't exist" from "exists but
 * belongs to someone else" (avoids leaking which resource IDs are valid).
 */
export function assertTenantOwnership(resourceTenantId: string, currentTenantId: string): void {
  if (resourceTenantId !== currentTenantId) {
    throw new AppError('Resource not found', ErrorCode.NOT_FOUND);
  }
}

/**
 * Set the Postgres session variable RLS policies key off of, on a specific
 * client (as opposed to withTenantTransaction, which does this internally
 * for its own connection). Useful for callers managing their own client/
 * transaction lifecycle directly.
 */
export async function setTenantSession(client: { query: (sql: string, params?: any[]) => Promise<any> }, tenantId: string): Promise<void> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new AppError(`setTenantSession called with invalid tenantId: ${JSON.stringify(tenantId)}`, ErrorCode.BAD_REQUEST);
  }
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

/** Clear the RLS session variable, e.g. before returning a client to a pool. */
export async function clearTenantSession(client: { query: (sql: string, params?: any[]) => Promise<any> }): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', true)");
}
