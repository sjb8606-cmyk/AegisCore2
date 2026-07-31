/**
 * Veridact v1.0 — Database Client
 *
 * Wraps pg.Pool to:
 *  1. Inject app.current_tenant_id into every connection before query execution.
 *  2. Enforce that tenant context is ALWAYS present on mutating queries.
 *  3. Expose a typed `withTenant` helper used by all engines.
 *
 * RLS enforcement: every query runs after setting app.current_tenant_id via
 * set_config(), picked up by the Postgres RLS policies in V1__base_schema.sql.
 *
 * NOTE: uses set_config('app.current_tenant_id', $1, true) rather than
 * `SET LOCAL app.current_tenant_id = $1` — Postgres's SET command does not
 * accept parameterized placeholders at all, only literal values. set_config()
 * is a normal function call, so it supports parameters correctly, and the
 * third argument (true) gives the same transaction-local scoping as SET LOCAL.
 */

import { Pool, PoolClient, QueryConfig, QueryResult } from 'pg';
import { logger } from './logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: true }
          : undefined,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'pg pool unexpected error');
    });
  }
  return pool;
}

export async function withTenant<T = unknown>(
  tenantId: string,
  queryFn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    const result = await queryFn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function tenantQuery<T>(
  tenantId: string,
  query: QueryConfig | string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return withTenant(tenantId, async (client) => {
    if (typeof query === 'string') {
      return client.query<T>(query, values);
    }
    return client.query<T>(query);
  });
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
