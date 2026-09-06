/**
 * @platform/snapshot
 * Real canonical JSON hash + version increment logic.
 * Uses relative imports to utils/tenancy/metering — mocked by those paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
const mockLoadConfig = vi.fn();

vi.mock('../../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST' },
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { createSnapshot, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const ENTITY = '33333333-3333-3333-3333-333333333333';

describe('snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadConfig.mockReturnValue({ enabled: true, maxSnapshotsPerEntity: 10 });
  });

  it('FORBIDDEN when disabled', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, maxSnapshotsPerEntity: 10 });
    await expect(createSnapshot(TENANT, 'doc', ENTITY, { a: 1 }, ACTOR))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('BAD_REQUEST when version limit exceeded', async () => {
    mockLoadConfig.mockReturnValue({ enabled: true, maxSnapshotsPerEntity: 2 });
    mockWithTenantQuery.mockResolvedValueOnce([{ last_v: 2 }]);
    await expect(createSnapshot(TENANT, 'doc', ENTITY, { a: 1 }, ACTOR))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/Version limit/i) });
  });

  it('creates snapshot with stable hash and next version', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ last_v: 3 }]) // max version
      .mockResolvedValueOnce([]);             // insert
    const result = await createSnapshot(TENANT, 'document', ENTITY, { b: 2, a: 1 }, ACTOR);
    expect(result.version).toBe(4);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    // hash is over sorted keys: {"a":1,"b":2}
    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update(JSON.stringify({ a: 1, b: 2 }, ['a', 'b'])).digest('hex');
    // Object.keys sort order for {b,a} after sort is a,b
    const canonical = JSON.stringify({ b: 2, a: 1 }, Object.keys({ b: 2, a: 1 }).sort());
    const expected2 = createHash('sha256').update(canonical).digest('hex');
    expect(result.hash).toBe(expected2);
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      eventType: 'api_call',
      idempotencyKey: `snap:${ENTITY}:4`,
    }));
  });
});
