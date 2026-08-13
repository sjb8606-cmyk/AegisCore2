import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../../tenancy/src/rls', () => {
  async function withTenantTransaction(fn: (client: any) => Promise<any>, tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID Mandatory');
    try {
      await mockClient.query('BEGIN');
      await mockClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await fn(mockClient);
      await mockClient.query('COMMIT');
      return result;
    } catch (err) {
      await mockClient.query('ROLLBACK');
      throw err;
    }
  }

  return {
    withTenantTransaction,
    withTenantQuery: async (sql: string, params: any[], tenantId: string) =>
      withTenantTransaction(async (client) => (await client.query(sql, params)).rows, tenantId),
    withTenant: async (tenantId: string, fn: (client: any) => Promise<any>) =>
      withTenantTransaction(fn, tenantId),
    getPool: vi.fn(),
  };
});

import { LotTraceabilityService, computeEventHash, GENESIS_HASH, ErrorCode } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const PARENT_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LotTraceabilityService.createLot', () => {
  it('rejects invalid input and rolls back cleanly', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(
      LotTraceabilityService.createLot(TENANT_ID, USER_ID, {
        sourceType: 'harvest',
        quantity: -5,
        unit: 'kg',
      }),
    ).rejects.toThrow();

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('creates a lot and appends a genesis-chained "created" event', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ id: LOT_ID, lot_code: 'LOT-TEST01', status: 'open', quantity: '100.000', unit: 'kg' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const lot = await LotTraceabilityService.createLot(TENANT_ID, USER_ID, {
      lotCode: 'LOT-TEST01',
      sourceType: 'harvest',
      quantity: 100,
      unit: 'kg',
    });

    expect(lot.id).toBe(LOT_ID);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    const eventInsert = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO lot_events'),
    );
    const [, , , , , prevHash, hash] = eventInsert[1];
    const expectedHash = computeEventHash(
      LOT_ID,
      'created',
      { lotCode: 'LOT-TEST01', quantity: 100, unit: 'kg', sourceType: 'harvest' },
      GENESIS_HASH,
    );
    expect(prevHash).toBe(GENESIS_HASH);
    expect(hash).toBe(expectedHash);
  });
});

describe('LotTraceabilityService.getLot', () => {
  it('throws NOT_FOUND when the lot does not exist', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    await expect(LotTraceabilityService.getLot(TENANT_ID, LOT_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('LotTraceabilityService.splitLot', () => {
  it('throws UNPROCESSABLE and rolls back when split quantities exceed the parent quantity', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            id: PARENT_ID,
            quantity: '100.000',
            status: 'open',
            unit: 'kg',
            source_type: 'harvest',
            source_ref_table: null,
            source_ref_id: null,
          },
        ],
      })
      .mockResolvedValueOnce(undefined);

    await expect(
      LotTraceabilityService.splitLot(TENANT_ID, USER_ID, PARENT_ID, {
        splits: [{ quantity: 60 }, { quantity: 60 }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.UNPROCESSABLE });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws CONFLICT and rolls back when the parent lot is already held', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: PARENT_ID, quantity: '100.000', status: 'held', unit: 'kg' }] })
      .mockResolvedValueOnce(undefined);

    await expect(
      LotTraceabilityService.splitLot(TENANT_ID, USER_ID, PARENT_ID, {
        splits: [{ quantity: 10 }, { quantity: 10 }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('LotTraceabilityService.holdLot', () => {
  it('throws CONFLICT when the lot is already on hold', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: LOT_ID, status: 'held' }] })
      .mockResolvedValueOnce(undefined);

    await expect(
      LotTraceabilityService.holdLot(TENANT_ID, USER_ID, LOT_ID, { reason: 'QC failure' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('LotTraceabilityService.releaseLot', () => {
  it('throws CONFLICT when the lot is not currently on hold', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: LOT_ID, status: 'open' }] })
      .mockResolvedValueOnce(undefined);

    await expect(LotTraceabilityService.releaseLot(TENANT_ID, USER_ID, LOT_ID)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('releases a held lot and appends a "released" event', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: LOT_ID, status: 'held' }] })
      .mockResolvedValueOnce({ rows: [{ id: LOT_ID, status: 'released' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const released = await LotTraceabilityService.releaseLot(TENANT_ID, USER_ID, LOT_ID);
    expect(released.status).toBe('released');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});
