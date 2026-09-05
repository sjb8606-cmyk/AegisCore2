import { Pool } from 'pg';
import { AppError, ErrorCode } from '../../utils/src/index';

let _pool: Pool | null = null;

let _testPoolOverride: any = null;
export function __setTestPool(pool: any | null): void {
  _testPoolOverride = pool;
}

export function getPool(): Pool {
  if (_testPoolOverride) return _testPoolOverride;
  if (!_pool) {
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

export async function withTenant(tenantId: string, fn: (client: any) => Promise<any>): Promise<any> {
  return withTenantTransaction(fn, tenantId);
}

export function assertTenantOwnership(resourceTenantId: string, currentTenantId: string): void {
  if (resourceTenantId !== currentTenantId) {
    throw new AppError('Resource not found', ErrorCode.NOT_FOUND);
  }
}

export async function setTenantSession(client: { query: (sql: string, params?: any[]) => Promise<any> }, tenantId: string): Promise<void> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new AppError(`setTenantSession called with invalid tenantId: ${JSON.stringify(tenantId)}`, ErrorCode.BAD_REQUEST);
  }
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

export async function clearTenantSession(client: { query: (sql: string, params?: any[]) => Promise<any> }): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', true)");
}
