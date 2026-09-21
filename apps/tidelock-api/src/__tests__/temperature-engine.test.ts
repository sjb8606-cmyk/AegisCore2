import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const setThreshold = vi.fn();
const logReading = vi.fn();
const getReadingsForLot = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/temperature-engine/src/index', () => ({
  TemperatureEngineService: {
    setThreshold: (...a: unknown[]) => setThreshold(...a),
    logReading: (...a: unknown[]) => logReading(...a),
    getReadingsForLot: (...a: unknown[]) => getReadingsForLot(...a),
  },
}));

import router from '../routes/temperature-engine';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const LID = '44444444-4444-4444-8444-444444444444';

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

describe('temperature-engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /threshold → 201', async () => {
    setThreshold.mockResolvedValueOnce({ maxC: 4 });
    const res = await request(app()).post('/threshold').send({ maxC: 4, minC: -2 });
    expect(res.status).toBe(201);
    expect(setThreshold).toHaveBeenCalledWith(T, U, { maxC: 4, minC: -2 });
  });

  it('POST /:lotId/reading → 201', async () => {
    logReading.mockResolvedValueOnce({ tempC: 1.2 });
    const res = await request(app()).post(`/${LID}/reading`).send({ tempC: 1.2 });
    expect(res.status).toBe(201);
    expect(logReading).toHaveBeenCalledWith(T, U, LID, { tempC: 1.2 });
  });

  it('GET /:lotId/readings → 200', async () => {
    getReadingsForLot.mockResolvedValueOnce([]);
    const res = await request(app()).get(`/${LID}/readings`);
    expect(res.status).toBe(200);
    expect(getReadingsForLot).toHaveBeenCalledWith(T, LID);
  });
});
