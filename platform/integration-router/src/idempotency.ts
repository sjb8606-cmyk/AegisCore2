import { getPool } from '@platform/tenancy';
import { AppError, ErrorCode } from '@platform/utils';
import type { IdempotencyRecord, IdempotencyStore } from './types';

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async reserve(tenantId: string, key: string, capability: string) {
    const mapKey = `${tenantId}:${key}`;
    const existing = this.records.get(mapKey);
    if (existing) return { kind: 'existing' as const, record: { ...existing } };
    const now = new Date().toISOString();
    const record: IdempotencyRecord = {
      tenantId, key, capability, status: 'in_progress', createdAt: now, updatedAt: now,
    };
    this.records.set(mapKey, record);
    return { kind: 'new' as const, record };
  }

  async complete(tenantId: string, key: string, providerId: string, result: unknown): Promise<void> {
    const mapKey = `${tenantId}:${key}`;
    const record = this.records.get(mapKey);
    if (!record) throw new AppError('Idempotency record not found', ErrorCode.NOT_FOUND);
    record.status = 'completed';
    record.providerId = providerId;
    record.result = result;
    record.updatedAt = new Date().toISOString();
  }

  async fail(tenantId: string, key: string, providerId: string | undefined, error: { code: string; message: string }): Promise<void> {
    const mapKey = `${tenantId}:${key}`;
    const record = this.records.get(mapKey);
    if (!record) throw new AppError('Idempotency record not found', ErrorCode.NOT_FOUND);
    record.status = 'failed';
    record.providerId = providerId;
    record.error = error;
    record.updatedAt = new Date().toISOString();
  }

  clear(): void { this.records.clear(); }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  async reserve(tenantId: string, key: string, capability: string) {
    const now = new Date().toISOString();
    const insert = await getPool().query(
      `INSERT INTO integration_idempotency
        (tenant_id, idempotency_key, capability, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'in_progress', $4, $4)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING tenant_id, idempotency_key, capability, status, provider_id, result, error, created_at, updated_at`,
      [tenantId, key, capability, now]
    );
    if (insert.rows[0]) return { kind: 'new' as const, record: this.map(insert.rows[0]) };

    const rows = await getPool().query(
      `SELECT tenant_id, idempotency_key, capability, status, provider_id, result, error, created_at, updated_at
       FROM integration_idempotency WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key]
    );
    if (!rows.rows[0]) throw new AppError('Unable to resolve idempotency record', ErrorCode.INTERNAL);
    return { kind: 'existing' as const, record: this.map(rows.rows[0]) };
  }

  async complete(tenantId: string, key: string, providerId: string, result: unknown): Promise<void> {
    await getPool().query(
      `UPDATE integration_idempotency SET status='completed', provider_id=$3, result=$4, updated_at=NOW()
       WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, key, providerId, JSON.stringify(result)]
    );
  }

  async fail(tenantId: string, key: string, providerId: string | undefined, error: { code: string; message: string }): Promise<void> {
    await getPool().query(
      `UPDATE integration_idempotency SET status='failed', provider_id=$3, error=$4, updated_at=NOW()
       WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, key, providerId ?? null, JSON.stringify(error)]
    );
  }

  private map(row: any): IdempotencyRecord {
    return {
      tenantId: row.tenant_id,
      key: row.idempotency_key,
      capability: row.capability,
      status: row.status,
      providerId: row.provider_id ?? undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }
}
