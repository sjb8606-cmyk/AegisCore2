import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const generateCatchReport = vi.fn();
const getReport = vi.fn();
const listReports = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));
vi.mock('../../../../platform/fisheries/compliance-reporter/src/index', () => ({
  ComplianceReporterService: {
    generateCatchReport: (...a: unknown[]) => generateCatchReport(...a),
    getReport: (...a: unknown[]) => getReport(...a),
    listReports: (...a: unknown[]) => listReports(...a),
  },
}));

import router from '../routes/compliance-reporter';

const T = '660f9500-f30c-52e5-b827-557766550001';
const U = '22222222-2222-2222-2222-222222222222';
const RID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

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

describe('compliance-reporter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /catch → 201', async () => {
    generateCatchReport.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).post('/catch').send({ fromDate: '2026-01-01' });
    expect(res.status).toBe(201);
    expect(generateCatchReport).toHaveBeenCalledWith(T, U, { fromDate: '2026-01-01' });
  });

  it('GET /:id → 200', async () => {
    getReport.mockResolvedValueOnce({ id: RID });
    const res = await request(app()).get(`/${RID}`);
    expect(res.status).toBe(200);
  });

  it('GET / lists → 200', async () => {
    listReports.mockResolvedValueOnce([]);
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(listReports).toHaveBeenCalledWith(T);
  });
});
