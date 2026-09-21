import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const setMarketRules = vi.fn();
const getMarketRules = vi.fn();
const generateLabel = vi.fn();
const listLabelsForLot = vi.fn();
const getLabel = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/labelling-engine/src/index', () => ({
  LabellingEngineService: {
    setMarketRules: (...a: unknown[]) => setMarketRules(...a),
    getMarketRules: (...a: unknown[]) => getMarketRules(...a),
    generateLabel: (...a: unknown[]) => generateLabel(...a),
    listLabelsForLot: (...a: unknown[]) => listLabelsForLot(...a),
    getLabel: (...a: unknown[]) => getLabel(...a),
  },
}));

import router from '../routes/labelling-engine';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const LID = '99999999-9999-4999-8999-999999999999';
const LBID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';

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

describe('labelling-engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /rules → 201', async () => {
    setMarketRules.mockResolvedValueOnce({ market: 'CA' });
    const res = await request(app()).post('/rules').send({ market: 'CA', requiredFields: ['lot'] });
    expect(res.status).toBe(201);
    expect(setMarketRules).toHaveBeenCalledWith(T, U, { market: 'CA', requiredFields: ['lot'] });
  });

  it('GET /rules/:market → 200', async () => {
    getMarketRules.mockResolvedValueOnce({ market: 'CA' });
    const res = await request(app()).get('/rules/CA');
    expect(res.status).toBe(200);
  });

  it('POST /:lotId/generate → 201', async () => {
    generateLabel.mockResolvedValueOnce({ id: LBID });
    const res = await request(app()).post(`/${LID}/generate`).send({ market: 'CA' });
    expect(res.status).toBe(201);
    expect(generateLabel).toHaveBeenCalledWith(T, U, LID, { market: 'CA' });
  });

  it('GET /:lotId/labels → 200', async () => {
    listLabelsForLot.mockResolvedValueOnce([]);
    const res = await request(app()).get(`/${LID}/labels`);
    expect(res.status).toBe(200);
  });

  it('GET /labels/:labelId → 200', async () => {
    getLabel.mockResolvedValueOnce({ id: LBID });
    const res = await request(app()).get(`/labels/${LBID}`);
    expect(res.status).toBe(200);
  });
});
