import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const computeYield = vi.fn();
const getYieldForBatch = vi.fn();
const getAverageYieldForSpecies = vi.fn();
const listYieldRecords = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/yield-engine/src/index', () => ({
  YieldEngineService: {
    computeYield: (...a: unknown[]) => computeYield(...a),
    getYieldForBatch: (...a: unknown[]) => getYieldForBatch(...a),
    getAverageYieldForSpecies: (...a: unknown[]) => getAverageYieldForSpecies(...a),
    listYieldRecords: (...a: unknown[]) => listYieldRecords(...a),
  },
}));

import router from '../routes/yield-engine';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const BID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

describe('yield-engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /:batchId/compute → 201', async () => {
    computeYield.mockResolvedValueOnce({ batchId: BID, yieldPercent: 85 });
    const res = await request(app()).post(`/${BID}/compute`);
    expect(res.status).toBe(201);
    expect(computeYield).toHaveBeenCalledWith(T, BID, U);
  });

  it('GET /batch/:batchId → 200', async () => {
    getYieldForBatch.mockResolvedValueOnce({ batchId: BID });
    const res = await request(app()).get(`/batch/${BID}`);
    expect(res.status).toBe(200);
  });

  it('GET /average/:speciesId → 200', async () => {
    getAverageYieldForSpecies.mockResolvedValueOnce(82.5);
    const res = await request(app()).get('/average/s1');
    expect(res.status).toBe(200);
    expect(res.body.averageYieldPercent).toBe(82.5);
  });

  it('GET / lists → 200', async () => {
    listYieldRecords.mockResolvedValueOnce([]);
    const res = await request(app()).get('/?underperformingOnly=true');
    expect(res.status).toBe(200);
    expect(listYieldRecords).toHaveBeenCalledWith(T, { speciesId: undefined, underperformingOnly: true });
  });
});
