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

export async function withTenantQuery(sql: string, params: any[], tenantId: string): Promise<any> {
  return withTenantTransaction(async (client) => {
    const result = await client.query(sql, params);
    return result.rows;
  }, tenantId);
}

// SWAP FIX: Veridact expects (tenantId, fn), we had (fn, tenantId)
export async function withTenant(tenantId: string, fn: (client: any) => Promise<any>): Promise<any> {
  return withTenantTransaction(fn, tenantId);
}
