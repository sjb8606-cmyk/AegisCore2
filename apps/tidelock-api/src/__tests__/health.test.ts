import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
    })),
  };
});

import { healthRouter } from '../health';

function buildApp() {
  const app = express();
  app.use(healthRouter);
  return app;
}

describe('tidelock-api health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVICE_NAME = 'tidelock-api';
    process.env.SERVICE_VERSION = '1.0.0';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  });

  it('GET /health returns 200 with status ok, service name, version, and ISO timestamp', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('tidelock-api');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('GET /ready returns 200 when Postgres responds', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(buildApp()).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.postgres.healthy).toBe(true);
    expect(typeof res.body.checks.postgres.latencyMs).toBe('number');
    expect(mockEnd).toHaveBeenCalled();
  });

  it('GET /ready returns 503 when Postgres is unreachable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(buildApp()).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.postgres.healthy).toBe(false);
  });
});
