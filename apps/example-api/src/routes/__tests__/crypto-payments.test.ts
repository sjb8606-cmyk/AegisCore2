import express from 'express';
import request from 'supertest';

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
import { cryptoPaymentsRouter } from '../crypto-payments';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PAYMENT_ID = '33333333-3333-3333-3333-333333333333';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['viewer'] };
    next();
  });
  app.use('/', cryptoPaymentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('crypto-payments routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has no DELETE /items/:id route (on-chain transactions are not reversible by this API)', async () => {
    const res = await request(buildApp()).delete(`/items/${PAYMENT_ID}`);

    expect(res.status).toBe(404);
  });

  it('POST /items creates a pending payment and wraps response in data envelope', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PAYMENT_ID, currency_code: 'BTC', amount: '0.05', wallet_address: 'bc1qxyz1234567890abcdefg', tx_hash: null, status: 'pending', created_at: new Date().toISOString(), confirmed_at: null },
    ]);

    const res = await request(buildApp())
      .post('/items')
      .send({ currencyCode: 'BTC', amount: 0.05, walletAddress: 'bc1qxyz1234567890abcdefg' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.tx_hash).toBeNull();
  });

  it('POST /items returns 422 on invalid body (non-positive amount)', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ currencyCode: 'BTC', amount: -1, walletAddress: 'bc1qxyz1234567890abcdefg' });

    expect(res.status).toBe(422);
  });

  it('POST /items returns 422 on a too-short walletAddress', async () => {
    const res = await request(buildApp())
      .post('/items')
      .send({ currencyCode: 'BTC', amount: 1, walletAddress: 'short' });

    expect(res.status).toBe(422);
  });

  it('GET /items returns 400 on invalid query', async () => {
    const res = await request(buildApp())
      .get('/items')
      .query({ limit: 'not-a-number' });

    expect(res.status).toBe(400);
  });

  it('GET /items returns paginated payments scoped to the user', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([
      { id: PAYMENT_ID, currency_code: 'ETH', amount: '1.2', wallet_address: '0xabc1234567890def', tx_hash: '0xdeadbeef', status: 'confirmed', created_at: new Date().toISOString(), confirmed_at: new Date().toISOString() },
    ]);

    const res = await request(buildApp()).get('/items');

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(PAYMENT_ID);
    const [, params] = (withTenantQuery as any).mock.calls[0];
    expect(params[0]).toBe(USER_ID);
  });
});
