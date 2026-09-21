import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const createBatch = vi.fn();
const completeBatch = vi.fn();
const cancelBatch = vi.fn();
const getBatch = vi.fn();
const listBatches = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/processing-batch/src/index', () => ({
  ProcessingBatchService: {
    createBatch: (...a: unknown[]) => createBatch(...a),
    completeBatch: (...a: unknown[]) => completeBatch(...a),
    cancelBatch: (...a: unknown[]) => cancelBatch(...a),
    getBatch: (...a: unknown[]) => getBatch(...a),
    listBatches: (...a: unknown[]) => listBatches(...a),
  },
}));

import router from '../routes/processing-batch';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _r, n) => { req.auth = { sub: U }; n(); });
  a.use('/', router);
  a.use((err: any, _q: any, res: any, _n: any) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return a;
}

describe('processing-batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST / creates batch → 201', async () => {
    createBatch.mockResolvedValueOnce({ id: ID, status: 'open' });
    const res = await request(app()).post('/').send({ speciesId: 's1' });
    expect(res.status).toBe(201);
    expect(createBatch).toHaveBeenCalledWith(T, U, { speciesId: 's1' });
  });

  it('POST /:id/complete → 200', async () => {
    completeBatch.mockResolvedValueOnce({ id: ID, status: 'complete' });
    const res = await request(app()).post(`/${ID}/complete`).send({ outputKg: 90 });
    expect(res.status).toBe(200);
    expect(completeBatch).toHaveBeenCalledWith(T, ID, U, { outputKg: 90 });
  });

  it('POST /:id/cancel → 200', async () => {
    cancelBatch.mockResolvedValueOnce({ id: ID, status: 'cancelled' });
    const res = await request(app()).post(`/${ID}/cancel`);
    expect(res.status).toBe(200);
    expect(cancelBatch).toHaveBeenCalledWith(T, ID, U);
  });

  it('GET /:id → 200', async () => {
    getBatch.mockResolvedValueOnce({ id: ID });
    const res = await request(app()).get(`/${ID}`);
    expect(res.status).toBe(200);
  });

  it('GET / lists with filters → 200', async () => {
    listBatches.mockResolvedValueOnce([]);
    const res = await request(app()).get('/?status=open');
    expect(res.status).toBe(200);
    expect(listBatches).toHaveBeenCalledWith(T, { speciesId: undefined, status: 'open' });
  });
});
