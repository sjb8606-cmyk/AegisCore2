import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';

jest.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: jest.fn(),
}));
jest.mock('../../../../../platform/audit/src/index', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: jest.fn().mockResolvedValue(undefined),
}));

import { withTenantQuery } from '../../../../../platform/tenancy/src/index';
import { blockchainVerifyRouter } from '../blockchain-verify';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const VERIFICATION_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', blockchainVerifyRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('blockchain-verify routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /items computes a real server-side SHA-256 hash of the content, ignoring any client-supplied hash', async () => {
    const content = 'this is the exact content being verified';
    const expectedHash = createHash('sha256').update(content).digest('hex');

    (withTenantQuery as any).mockImplementationOnce(async (sql: string, params: any[]) => {
      const [, , resourceRef, contentHash] = params;
      // confirm the hash passed to the DB matches a real SHA-256 of the content
      expect(contentHash).toBe(expectedHash);
      return [{ id: VERIFICATION_ID, resource_ref: resourceRef, content_hash: contentHash, chain: 'internal', tx_ref: null, verified_at: null, created_at: new Date().toISOString() }];
    });

    const res = await request(buildApp())
      .post('/items')
      .send({ resourceRef: 'DOC-001', content, contentHash: 'attacker-supplied-fake-hash' }); // extra field should be ignored

    expect(res.status).toBe(201);
    expect(res.body.data.content_hash).toBe(expectedHash);
    expect(res.body.data.content_hash).not.toBe('attacker-supplied-fake-hash');
  });

  it('POST /items produces different hashes for different content (real hashing, not a stub)', async () => {
    const seenHashes: string[] = [];
    (withTenantQuery as any).mockImplementation(async (sql: string, params: any[]) => {
      const [, , resourceRef, contentHash] = params;
      return [{ id: VERIFICATION_ID, resource_ref: resourceRef, content_hash: contentHash, chain: 'internal', tx_ref: null, verified_at: null, created_at: new Date().toISOString() }];
    });

    for (const content of ['content A', 'content B']) {
      const res = await request(buildApp()).post('/items').send({ resourceRef: 'DOC-001', content });
      seenHashes.push(res.body.data.content_hash);
    }

    expect(seenHashes[0]).not.toBe(seenHashes[1]);
  });

  it('POST /items returns 422 on invalid body', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ resourceRef: '', content: '' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated records scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: VERIFICATION_ID, resource_ref: 'DOC-001', content_hash: 'abc123', chain: 'internal', tx_ref: null, verified_at: null, created_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(VERIFICATION_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });

  it('DELETE /items/:id removes a record owned by the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: VERIFICATION_ID }]);

    const res = await request(buildApp()).delete(`/items/${VERIFICATION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VERIFICATION_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params).toEqual([VERIFICATION_ID, USER_ID]);
  });

  it('DELETE /items/:id returns 404 when record not found or not owned', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);

    const res = await request(buildApp()).delete(`/items/${VERIFICATION_ID}`);

    expect(res.status).toBe(404);
  });
});
