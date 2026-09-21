import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const sendLossAlert = vi.fn();
const listAlerts = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/loss-alert/src/index', () => ({
  LossAlertService: {
    sendLossAlert: (...a: unknown[]) => sendLossAlert(...a),
    listAlerts: (...a: unknown[]) => listAlerts(...a),
  },
}));

import router from '../routes/loss-alert';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const YID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

describe('loss-alert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /:yieldRecordId/send → 201', async () => {
    sendLossAlert.mockResolvedValueOnce({ id: 'a1', yieldRecordId: YID });
    const res = await request(app()).post(`/${YID}/send`);
    expect(res.status).toBe(201);
    expect(sendLossAlert).toHaveBeenCalledWith(T, YID, U);
  });

  it('GET / lists → 200', async () => {
    listAlerts.mockResolvedValueOnce([]);
    const res = await request(app()).get('/?speciesId=s1');
    expect(res.status).toBe(200);
    expect(listAlerts).toHaveBeenCalledWith(T, { speciesId: 's1' });
  });
});
