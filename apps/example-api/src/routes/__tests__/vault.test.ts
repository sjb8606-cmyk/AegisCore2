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
vi.mock('../../../../../platform/security/src/index', () => ({
  encryptField: vi.fn(),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { encryptField } from '../../../../../platform/security/src/index';
import { vaultRouter } from '../vault';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SECRET_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', vaultRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('vault routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /items calls the real encryptField and never echoes plaintext or ciphertext back', async () => {
    (encryptField as any).mockResolvedValueOnce('kms-envelope-ciphertext-blob');
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SECRET_ID, name: 'stripe-api-key', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ name: 'stripe-api-key', value: 'sk_live_super_secret_plaintext' });

    expect(res.status).toBe(201);
    expect(encryptField).toHaveBeenCalledWith('sk_live_super_secret_plaintext');
    // response must contain only metadata
    expect(res.body.data).toEqual({ id: SECRET_ID, name: 'stripe-api-key', created_at: expect.any(String), updated_at: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toContain('sk_live_super_secret_plaintext');
    expect(JSON.stringify(res.body)).not.toContain('kms-envelope-ciphertext-blob');
    // confirm the encrypted value (not plaintext) is what's passed to the DB, via upsert
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).toContain('ON CONFLICT (tenant_id, name)');
    expect(params).toContain('kms-envelope-ciphertext-blob');
    expect(params).not.toContain('sk_live_super_secret_plaintext');
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ name: '', value: '' });

    expect(res.status).toBe(422);
    expect(encryptField).not.toHaveBeenCalled();
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns only metadata, never encrypted_value, scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: SECRET_ID, name: 'stripe-api-key', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({ id: SECRET_ID, name: 'stripe-api-key', created_at: expect.any(String), updated_at: expect.any(String) });
    expect(res.body.data[0]).not.toHaveProperty('encrypted_value');
    expect(res.body.data[0]).not.toHaveProperty('value');
    const [sql, params] = (withTenantQuery as any).mock.calls[0];
    expect(sql).not.toContain('encrypted_value');
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a secret owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: SECRET_ID }]);

    const res = await request(buildApp()).delete(`/items/${SECRET_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SECRET_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([SECRET_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when secret not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${SECRET_ID}`);

    expect(res.status).toBe(404);
  });
});
