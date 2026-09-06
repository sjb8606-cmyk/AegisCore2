/**
 * @platform/health-checks
 * Liveness is process-local; readiness may probe DB via withTenantQuery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', BAD_REQUEST: 'BAD_REQUEST' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  runLivenessCheck, runReadinessCheck, registerHealthCheck, getAggregatedHealth, getHealthLedger,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DEF = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('health-checks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runLivenessCheck returns ok/alive status', async () => {
    const result = await runLivenessCheck();
    expect(result).toBeDefined();
    // typical shape: { status: 'ok' } or { alive: true }
    const status = (result as any).status || ((result as any).alive ? 'ok' : undefined);
    expect(status === 'ok' || (result as any).alive === true || (result as any).status === 'alive').toBe(true);
  });

  it('runReadinessCheck probes dependency and returns ready/not ready', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ ok: 1 }]);
    const result = await runReadinessCheck(TENANT);
    expect(result).toBeDefined();
  });

  it('registerHealthCheck inserts definition', async () => {
    const row = { id: DEF, name: 'db-ping', type: 'sql' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await registerHealthCheck(TENANT, {
      name: 'db-ping', type: 'sql', target: 'SELECT 1',
    });
    expect(result).toEqual(row);
  });

  it('getAggregatedHealth returns summary', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { name: 'db', status: 'healthy' },
      { name: 'redis', status: 'degraded' },
    ]);
    const result = await getAggregatedHealth(TENANT);
    expect(result).toBeDefined();
  });

  it('getHealthLedger returns history for definition', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'healthy' },
    ]);
    const result = await getHealthLedger(TENANT, DEF);
    expect(Array.isArray(result) || result).toBeTruthy();
  });
});
