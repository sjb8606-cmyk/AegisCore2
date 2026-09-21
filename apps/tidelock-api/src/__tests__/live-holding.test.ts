import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const registerTank = vi.fn();
const listTanks = vi.fn();
const placeLot = vi.fn();
const listActiveHoldings = vi.fn();
const getHoldingRecord = vi.fn();
const getHoldingHistory = vi.fn();
const recordMortality = vi.fn();
const transfer = vi.fn();
const remove = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/live-holding/src/index', () => ({
  LiveHoldingService: {
    registerTank: (...a: unknown[]) => registerTank(...a),
    listTanks: (...a: unknown[]) => listTanks(...a),
    placeLot: (...a: unknown[]) => placeLot(...a),
    listActiveHoldings: (...a: unknown[]) => listActiveHoldings(...a),
    getHoldingRecord: (...a: unknown[]) => getHoldingRecord(...a),
    getHoldingHistory: (...a: unknown[]) => getHoldingHistory(...a),
    recordMortality: (...a: unknown[]) => recordMortality(...a),
    transfer: (...a: unknown[]) => transfer(...a),
    remove: (...a: unknown[]) => remove(...a),
  },
}));

import router from '../routes/live-holding';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const LID = '77777777-7777-4777-8777-777777777777';
const RID = '88888888-8888-4888-8888-888888888888';

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

describe('live-holding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /tanks → 201', async () => {
    registerTank.mockResolvedValueOnce({ id: 'tank1' });
    const res = await request(app()).post('/tanks').send({ name: 'Tank A', capacityKg: 500 });
    expect(res.status).toBe(201);
    expect(registerTank).toHaveBeenCalledWith(T, U, { name: 'Tank A', capacityKg: 500 });
  });

  it('GET /tanks → 200', async () => {
    listTanks.mockResolvedValueOnce([]);
    const res = await request(app()).get('/tanks');
    expect(res.status).toBe(200);
  });

  it('POST /lots/:lotId/place → 201', async () => {
    placeLot.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).post(`/lots/${LID}/place`).send({ tankId: 'tank1' });
    expect(res.status).toBe(201);
    expect(placeLot).toHaveBeenCalledWith(T, U, LID, { tankId: 'tank1' });
  });

  it('GET /records → 200', async () => {
    listActiveHoldings.mockResolvedValueOnce([]);
    const res = await request(app()).get('/records');
    expect(res.status).toBe(200);
  });

  it('GET /records/:id → 200', async () => {
    getHoldingRecord.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).get(`/records/${RID}`);
    expect(res.status).toBe(200);
  });

  it('GET /records/:id/history → 200', async () => {
    getHoldingHistory.mockResolvedValueOnce([]);
    const res = await request(app()).get(`/records/${RID}/history`);
    expect(res.status).toBe(200);
  });

  it('POST /records/:id/mortality → 200', async () => {
    recordMortality.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).post(`/records/${RID}/mortality`).send({ count: 2 });
    expect(res.status).toBe(200);
  });

  it('POST /records/:id/transfer → 200', async () => {
    transfer.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).post(`/records/${RID}/transfer`).send({ toTankId: 'tank2' });
    expect(res.status).toBe(200);
  });

  it('POST /records/:id/remove → 200', async () => {
    remove.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).post(`/records/${RID}/remove`).send({ reason: 'sold' });
    expect(res.status).toBe(200);
  });
});
