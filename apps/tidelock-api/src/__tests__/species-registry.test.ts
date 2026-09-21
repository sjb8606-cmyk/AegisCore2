import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const createSpecies = vi.fn();
const getSpecies = vi.fn();
const listSpecies = vi.fn();
const updateSpecies = vi.fn();
const deactivateSpecies = vi.fn();

vi.mock('../../../../platform/tenancy/src/index', () => ({
  getCurrentTenantId: () => '660f9500-f30c-52e5-b827-557766550001',
}));

vi.mock('../../../../platform/fisheries/species-registry/src/index', () => ({
  SpeciesRegistryService: {
    createSpecies: (...a: unknown[]) => createSpecies(...a),
    getSpecies: (...a: unknown[]) => getSpecies(...a),
    listSpecies: (...a: unknown[]) => listSpecies(...a),
    updateSpecies: (...a: unknown[]) => updateSpecies(...a),
    deactivateSpecies: (...a: unknown[]) => deactivateSpecies(...a),
  },
}));

import speciesRouter from '../routes/species-registry';

const TENANT_ID = '660f9500-f30c-52e5-b827-557766550001';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SPECIES_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SAMPLE = { id: SPECIES_ID, commonName: 'Atlantic Salmon', scientificName: 'Salmo salar', active: true };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles: ['operator'] };
    next();
  });
  app.use('/', speciesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: err.message || 'Internal error' });
  });
  return app;
}

describe('tidelock-api species-registry routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST / creates a species and returns 201', async () => {
    createSpecies.mockResolvedValueOnce(SAMPLE);
    const res = await request(buildApp()).post('/').send({ commonName: 'Atlantic Salmon', scientificName: 'Salmo salar' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(SAMPLE);
    expect(createSpecies).toHaveBeenCalledWith(TENANT_ID, USER_ID, { commonName: 'Atlantic Salmon', scientificName: 'Salmo salar' });
  });

  it('POST / propagates validation errors as 422', async () => {
    const err: any = new Error('commonName is required');
    err.statusCode = 422;
    createSpecies.mockRejectedValueOnce(err);
    const res = await request(buildApp()).post('/').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('GET /:id returns 200 with the species', async () => {
    getSpecies.mockResolvedValueOnce(SAMPLE);
    const res = await request(buildApp()).get(`/${SPECIES_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SAMPLE);
  });

  it('GET /:id returns 404 when not found', async () => {
    const err: any = new Error('Species not found');
    err.statusCode = 404;
    getSpecies.mockRejectedValueOnce(err);
    const res = await request(buildApp()).get(`/${SPECIES_ID}`);
    expect(res.status).toBe(404);
  });

  it('GET / lists species (activeOnly default true)', async () => {
    listSpecies.mockResolvedValueOnce([SAMPLE]);
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(listSpecies).toHaveBeenCalledWith(TENANT_ID, { activeOnly: true });
  });

  it('GET /?activeOnly=false passes activeOnly false', async () => {
    listSpecies.mockResolvedValueOnce([SAMPLE]);
    const res = await request(buildApp()).get('/?activeOnly=false');
    expect(res.status).toBe(200);
    expect(listSpecies).toHaveBeenCalledWith(TENANT_ID, { activeOnly: false });
  });

  it('PATCH /:id updates and returns 200', async () => {
    updateSpecies.mockResolvedValueOnce({ ...SAMPLE, commonName: 'Salmon' });
    const res = await request(buildApp()).patch(`/${SPECIES_ID}`).send({ commonName: 'Salmon' });
    expect(res.status).toBe(200);
    expect(res.body.commonName).toBe('Salmon');
  });

  it('POST /:id/deactivate returns 200', async () => {
    deactivateSpecies.mockResolvedValueOnce({ ...SAMPLE, active: false });
    const res = await request(buildApp()).post(`/${SPECIES_ID}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});
