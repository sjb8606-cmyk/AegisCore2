import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { keyManagementRouter } from '../key-management';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const KEY_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', keyManagementRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('key-management routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items generates a real random key, stores only a hash, and returns plaintext exactly once', async () => {
    (withTenantQuery as any).mockImplementationOnce(async (sql: string, params: any[]) => {
      // capture what was actually persisted — the key_prefix and key_hash args
      const [, , name, keyPrefix, keyHash] = params;
      expect(keyPrefix).toMatch(/^sk_/);
      expect(keyHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/); // salt:derived hex format
      return [{ id: KEY_ID, name, key_prefix: keyPrefix, created_at: new Date().toISOString() }];
    });

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'CI deploy key' });

    expect(res.status).toBe(201);
    expect(res.body.data.apiKey).toMatch(/^sk_/);
    expect(res.body.data.key_prefix).toBe(res.body.data.apiKey.slice(0, 11));
    // the raw key must never appear alongside a stored hash string
    expect(res.body.data).not.toHaveProperty('key_hash');
  });

  it('two separate POSTs generate different, non-deterministic keys', async () => {
    const seenKeys: string[] = [];
    (withTenantQuery as any).mockImplementation(async (sql: string, params: any[]) => {
      const [, , name, keyPrefix] = params;
      return [{ id: KEY_ID, name, key_prefix: keyPrefix, created_at: new Date().toISOString() }];
    });

    for (let i = 0; i < 2; i++) {
      const res = await request(buildApp()).post('/items').send({ name: `key ${i}` });
      seenKeys.push(res.body.data.apiKey);
    }

    expect(seenKeys[0]).not.toBe(seenKeys[1]);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only metadata + prefix, never key_hash or apiKey, scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: KEY_ID, name: 'CI deploy key', key_prefix: 'sk_abc12345', last_used_at: null, created_at: new Date().toISOString(), revoked_at: null },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('key_hash');
    expect(res.body.data[0]).not.toHaveProperty('apiKey');
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).not.toContain('key_hash');
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id revokes a key via UPDATE, guarded against double-revoke', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: KEY_ID }]);

    const res = await request(buildApp()).delete(`/items/${KEY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(KEY_ID);
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('SET revoked_at = NOW()');
    expect(sql).toContain('AND revoked_at IS NULL');
    expect(params).toEqual([KEY_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when key not found, not owned, or already revoked', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${KEY_ID}`);

    expect(res.status).toBe(404);
  });
});
