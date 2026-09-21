import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const startShift = vi.fn();
const endShift = vi.fn();
const getActiveShift = vi.fn();
const getShift = vi.fn();
const listShifts = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/shift-huddle/src/index', () => ({
  ShiftHuddleService: {
    startShift: (...a: unknown[]) => startShift(...a),
    endShift: (...a: unknown[]) => endShift(...a),
    getActiveShift: (...a: unknown[]) => getActiveShift(...a),
    getShift: (...a: unknown[]) => getShift(...a),
    listShifts: (...a: unknown[]) => listShifts(...a),
  },
}));

import router from '../routes/shift-huddle';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';

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

describe('shift-huddle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST / starts shift → 201', async () => {
    startShift.mockResolvedValueOnce({ id: SID, shiftType: 'processing' });
    const res = await request(app()).post('/').send({ shiftType: 'processing' });
    expect(res.status).toBe(201);
    expect(startShift).toHaveBeenCalledWith(T, U, { shiftType: 'processing' });
  });

  it('POST /:id/end → 200', async () => {
    endShift.mockResolvedValueOnce({ id: SID, status: 'ended' });
    const res = await request(app()).post(`/${SID}/end`).send({ notes: 'done' });
    expect(res.status).toBe(200);
    expect(endShift).toHaveBeenCalledWith(T, SID, U, { notes: 'done' });
  });

  it('GET /active/:shiftType → 200', async () => {
    getActiveShift.mockResolvedValueOnce({ id: SID });
    const res = await request(app()).get('/active/processing');
    expect(res.status).toBe(200);
    expect(getActiveShift).toHaveBeenCalledWith(T, 'processing');
  });

  it('GET /:id → 200', async () => {
    getShift.mockResolvedValueOnce({ id: SID });
    const res = await request(app()).get(`/${SID}`);
    expect(res.status).toBe(200);
  });

  it('GET / lists → 200', async () => {
    listShifts.mockResolvedValueOnce([]);
    const res = await request(app()).get('/?shiftType=QC');
    expect(res.status).toBe(200);
  });
});
