import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const openInvestigation = vi.fn();
const resolveInvestigation = vi.fn();
const getInvestigation = vi.fn();
const listOpenInvestigations = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/hold-release/src/index', () => ({
  HoldReleaseService: {
    openInvestigation: (...a: unknown[]) => openInvestigation(...a),
    resolveInvestigation: (...a: unknown[]) => resolveInvestigation(...a),
    getInvestigation: (...a: unknown[]) => getInvestigation(...a),
    listOpenInvestigations: (...a: unknown[]) => listOpenInvestigations(...a),
  },
}));

import router from '../routes/hold-release';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const LID = '55555555-5555-4555-8555-555555555555';
const IID = '66666666-6666-4666-8666-666666666666';

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

describe('hold-release', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /:lotId/investigate → 201', async () => {
    openInvestigation.mockResolvedValueOnce({ id: IID });
    const res = await request(app()).post(`/${LID}/investigate`).send({ reason: 'temp breach' });
    expect(res.status).toBe(201);
    expect(openInvestigation).toHaveBeenCalledWith(T, U, LID, { reason: 'temp breach' });
  });

  it('POST /investigations/:id/resolve → 200', async () => {
    resolveInvestigation.mockResolvedValueOnce({ id: IID, status: 'resolved' });
    const res = await request(app()).post(`/investigations/${IID}/resolve`).send({ outcome: 'release' });
    expect(res.status).toBe(200);
    expect(resolveInvestigation).toHaveBeenCalledWith(T, U, IID, { outcome: 'release' });
  });

  it('GET /investigations/:id → 200', async () => {
    getInvestigation.mockResolvedValueOnce({ id: IID });
    const res = await request(app()).get(`/investigations/${IID}`);
    expect(res.status).toBe(200);
  });

  it('GET /investigations → 200', async () => {
    listOpenInvestigations.mockResolvedValueOnce([]);
    const res = await request(app()).get('/investigations');
    expect(res.status).toBe(200);
    expect(listOpenInvestigations).toHaveBeenCalledWith(T);
  });
});
