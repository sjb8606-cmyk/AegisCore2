import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const logShipment = vi.fn();
const getShipment = vi.fn();
const listShipments = vi.fn();
const getTotalWeightForSpecies = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/shipment-intake/src/index', () => ({
  ShipmentIntakeService: {
    logShipment: (...a: unknown[]) => logShipment(...a),
    getShipment: (...a: unknown[]) => getShipment(...a),
    listShipments: (...a: unknown[]) => listShipments(...a),
    getTotalWeightForSpecies: (...a: unknown[]) => getTotalWeightForSpecies(...a),
  },
}));

import router from '../routes/shipment-intake';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

describe('shipment-intake', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST / logs shipment → 201', async () => {
    logShipment.mockResolvedValueOnce({ id: ID, weightKg: 120 });
    const res = await request(app()).post('/').send({ speciesId: 's1', weightKg: 120 });
    expect(res.status).toBe(201);
    expect(logShipment).toHaveBeenCalledWith(T, U, { speciesId: 's1', weightKg: 120 });
  });

  it('GET /:id → 200', async () => {
    getShipment.mockResolvedValueOnce({ id: ID });
    const res = await request(app()).get(`/${ID}`);
    expect(res.status).toBe(200);
    expect(getShipment).toHaveBeenCalledWith(T, ID);
  });

  it('GET / lists with filters → 200', async () => {
    listShipments.mockResolvedValueOnce([]);
    const res = await request(app()).get('/?speciesId=s1&fromDate=2026-01-01');
    expect(res.status).toBe(200);
    expect(listShipments).toHaveBeenCalledWith(T, { speciesId: 's1', fromDate: '2026-01-01', toDate: undefined });
  });

  it('GET /total-weight → 200', async () => {
    getTotalWeightForSpecies.mockResolvedValueOnce(500);
    const res = await request(app()).get('/total-weight?speciesId=s1');
    expect(res.status).toBe(200);
    expect(res.body.totalWeightKg).toBe(500);
  });

  it('propagates 404', async () => {
    const err: any = new Error('not found'); err.statusCode = 404;
    getShipment.mockRejectedValueOnce(err);
    const res = await request(app()).get(`/${ID}`);
    expect(res.status).toBe(404);
  });
});
