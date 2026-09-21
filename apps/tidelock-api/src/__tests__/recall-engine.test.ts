import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const generateRecallReport = vi.fn();
const cascadeHold = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/recall-engine/src/index', () => ({
  RecallEngineService: {
    generateRecallReport: (...a: unknown[]) => generateRecallReport(...a),
    cascadeHold: (...a: unknown[]) => cascadeHold(...a),
  },
}));

import router from '../routes/recall-engine';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const LID = '33333333-3333-4333-8333-333333333333';

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

describe('recall-engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /:lotId → 200', async () => {
    generateRecallReport.mockResolvedValueOnce({ lotId: LID, nodes: [] });
    const res = await request(app()).get(`/${LID}`);
    expect(res.status).toBe(200);
    expect(generateRecallReport).toHaveBeenCalledWith(T, LID);
  });

  it('POST /:lotId/hold → 200', async () => {
    cascadeHold.mockResolvedValueOnce({ lotId: LID, held: true });
    const res = await request(app()).post(`/${LID}/hold`).send({ reason: 'contamination' });
    expect(res.status).toBe(200);
    expect(cascadeHold).toHaveBeenCalledWith(T, U, LID, { reason: 'contamination' });
  });
});
