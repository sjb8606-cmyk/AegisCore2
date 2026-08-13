import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = { query: vi.fn() };

vi.mock('@platform/tenancy', () => {
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
    withTenant: (tenantId: string, fn: (client: any) => Promise<any>) => withTenantTransaction(fn, tenantId),
    withTenantQuery: (sql: string, params: any[], tenantId: string) =>
      withTenantTransaction(async (client) => (await client.query(sql, params)).rows, tenantId),
  };
});

vi.mock('@platform/lot-traceability', () => ({
  LotTraceabilityService: { getLot: vi.fn() },
}));

import { LiveHoldingService, ErrorCode } from '../index';
import { LotTraceabilityService } from '@platform/lot-traceability';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LOT_ID = '33333333-3333-3333-3333-333333333333';
const TANK_ID = '44444444-4444-4444-4444-444444444444';
const TANK_B_ID = '66666666-6666-6666-6666-666666666666';
const RECORD_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  (LotTraceabilityService.getLot as any).mockResolvedValue({ id: LOT_ID });
});

describe('LiveHoldingService.registerTank', () => {
  it('registers a tank', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: TANK_ID, tank_code: 'TANK-01', status: 'active' }] })
      .mockResolvedValueOnce(undefined);

    const tank = await LiveHoldingService.registerTank(TENANT_ID, USER_ID, {
      tankCode: 'TANK-01',
      capacityCount: 500,
    });
    expect(tank.tank_code).toBe('TANK-01');
  });
});

describe('LiveHoldingService.placeLot', () => {
  it('confirms the lot is real, creates a holding record, and logs a "placed" event', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ id: RECORD_ID, lot_id: LOT_ID, tank_id: TANK_ID, current_count: 200, status: 'active' }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const record = await LiveHoldingService.placeLot(TENANT_ID, USER_ID, LOT_ID, {
      tankId: TANK_ID,
      count: 200,
    });

    expect(LotTraceabilityService.getLot).toHaveBeenCalledWith(TENANT_ID, LOT_ID);
    expect(record.current_count).toBe(200);

    const eventInsert = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO live_holding_events'),
    );
    expect(eventInsert[1]).toEqual([TENANT_ID, RECORD_ID, 'placed', 200, null, null, USER_ID]);
  });
});

describe('LiveHoldingService.recordMortality', () => {
  it('decrements the live count and stays active when count remains above zero', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 200, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 190, status: 'active' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const updated = await LiveHoldingService.recordMortality(TENANT_ID, USER_ID, RECORD_ID, { count: 10 });
    expect(updated.current_count).toBe(190);
    expect(updated.status).toBe('active');
  });

  it('auto-closes the record as mortality_total_loss when the count reaches exactly zero', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 5, status: 'active' }] })
      .mockResolvedValueOnce({
        rows: [{ id: RECORD_ID, current_count: 0, status: 'closed', closed_reason: 'mortality_total_loss' }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const updated = await LiveHoldingService.recordMortality(TENANT_ID, USER_ID, RECORD_ID, { count: 5 });
    expect(updated.status).toBe('closed');
    expect(updated.closed_reason).toBe('mortality_total_loss');
  });

  it('rejects a mortality count greater than the current live count, before any update', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 5, status: 'active' }] })
      .mockResolvedValueOnce(undefined);

    await expect(
      LiveHoldingService.recordMortality(TENANT_ID, USER_ID, RECORD_ID, { count: 50 }),
    ).rejects.toMatchObject({ code: ErrorCode.UNPROCESSABLE });

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws CONFLICT when the holding record is already closed', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 0, status: 'closed' }] })
      .mockResolvedValueOnce(undefined);

    await expect(
      LiveHoldingService.recordMortality(TENANT_ID, USER_ID, RECORD_ID, { count: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('throws NOT_FOUND for a nonexistent holding record', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    await expect(
      LiveHoldingService.recordMortality(TENANT_ID, USER_ID, RECORD_ID, { count: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('LiveHoldingService.transfer', () => {
  it('moves the holding record to a new tank and logs the transfer', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, tank_id: TANK_ID, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, tank_id: TANK_B_ID, status: 'active' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const updated = await LiveHoldingService.transfer(TENANT_ID, USER_ID, RECORD_ID, { toTankId: TANK_B_ID });
    expect(updated.tank_id).toBe(TANK_B_ID);
  });
});

describe('LiveHoldingService.remove', () => {
  it('closes the record and logs the full remaining count as removed', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 150, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: RECORD_ID, current_count: 0, status: 'closed', closed_reason: 'shipped_out' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const updated = await LiveHoldingService.remove(TENANT_ID, USER_ID, RECORD_ID, { reason: 'shipped_out' });
    expect(updated.status).toBe('closed');
    expect(updated.closed_reason).toBe('shipped_out');

    const eventInsert = mockClient.query.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO live_holding_events'),
    );
    expect(eventInsert[1][3]).toBe(-150);
  });
});

describe('LiveHoldingService.getHoldingRecord', () => {
  it('throws NOT_FOUND for a nonexistent record', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    await expect(LiveHoldingService.getHoldingRecord(TENANT_ID, RECORD_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
