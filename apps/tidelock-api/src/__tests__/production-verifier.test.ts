import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const getBatch = vi.fn();
const getYieldForBatch = vi.fn();
const recordBatchCompletion = vi.fn();
const recordYieldComputation = vi.fn();
const verifyProductionIntegrity = vi.fn();
const getVerificationHistory = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/processing-batch/src/index', () => ({
  ProcessingBatchService: { getBatch: (...a: unknown[]) => getBatch(...a) },
}));
vi.mock('../../../../platform/fisheries/yield-engine/src/index', () => ({
  YieldEngineService: { getYieldForBatch: (...a: unknown[]) => getYieldForBatch(...a) },
}));
vi.mock('../../../../platform/fisheries/production-verifier/src/index', () => ({
  ProductionVerifierService: {
    recordBatchCompletion: (...a: unknown[]) => recordBatchCompletion(...a),
    recordYieldComputation: (...a: unknown[]) => recordYieldComputation(...a),
    verifyProductionIntegrity: (...a: unknown[]) => verifyProductionIntegrity(...a),
    getVerificationHistory: (...a: unknown[]) => getVerificationHistory(...a),
  },
}));

import router from '../routes/production-verifier';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const BID = '22222222-2222-4222-8222-222222222222';

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

describe('production-verifier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /batch/:batchId → 201', async () => {
    const batch = { id: BID, status: 'complete' };
    getBatch.mockResolvedValueOnce(batch);
    recordBatchCompletion.mockResolvedValueOnce({ eventId: 'e1' });
    const res = await request(app()).post(`/batch/${BID}`);
    expect(res.status).toBe(201);
    expect(recordBatchCompletion).toHaveBeenCalledWith(T, U, batch);
  });

  it('POST /yield/:yieldRecordId → 201', async () => {
    const yr = { id: 'y1', yieldPercent: 80 };
    getYieldForBatch.mockResolvedValueOnce(yr);
    recordYieldComputation.mockResolvedValueOnce({ eventId: 'e2' });
    const res = await request(app()).post('/yield/y1');
    expect(res.status).toBe(201);
    expect(recordYieldComputation).toHaveBeenCalledWith(T, U, yr);
  });

  it('POST /integrity → 200', async () => {
    verifyProductionIntegrity.mockResolvedValueOnce({ ok: true });
    const res = await request(app()).post('/integrity');
    expect(res.status).toBe(200);
    expect(verifyProductionIntegrity).toHaveBeenCalledWith(T);
  });

  it('GET /history → 200', async () => {
    getVerificationHistory.mockResolvedValueOnce([]);
    const res = await request(app()).get('/history');
    expect(res.status).toBe(200);
  });
});
