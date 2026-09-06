import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn();
  const readFileSyncMock = vi.fn();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    default: { ...actual, existsSync: existsSyncMock, readFileSync: readFileSyncMock },
  };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/utils (AppError/ErrorCode/parseUserId) is real -- pure, side-effect-free.

import { withTenantQuery } from '@platform/tenancy';
import { ErrorCode } from '@platform/utils';
import { createShipment, updateDriverLocation, getPublicTracking } from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const driverId = '33333333-3333-3333-3333-333333333333';
const trackingToken = 'abcdef1234567890abcdef1234567890';

function mockConfig(cfg: unknown) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createShipment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates a date-scoped tracking number and stores address/contact defaults', async () => {
    mockConfig({ enabled: true, limits: { shipmentCount: 500 } });
    const insertedRow = { id: 'ship-1', tracking_number: 'SHIP-20260115-0004' };
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '10' }]) // shipment count usage
      .mockResolvedValueOnce([{ seq: '3' }])    // daily sequence
      .mockResolvedValueOnce([insertedRow]);    // insert

    const result = await createShipment(tenantId, userId, {
      senderName: 'Acme Warehouse',
      recipientName: 'Jane Doe',
    });

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[2];
    // [shipmentId, tenantId, trackingNumber, trackingToken, senderName, senderAddress, recipientName, recipientAddress, recipientEmail, weightKg, description]
    expect(params[2]).toBe('SHIP-20260115-0004');
    expect(params[5]).toBe('{}');   // senderAddress default
    expect(params[7]).toBe('{}');   // recipientAddress default
    expect(params[8]).toBeNull();   // recipientEmail default
    expect(params[9]).toBeNull();   // weightKg default
    expect(params[10]).toBeNull();  // description default
  });

  it('BUG: userId is completely unused -- an invalid, non-UUID value is silently accepted', async () => {
    mockConfig({ enabled: true, limits: { shipmentCount: 500 } });
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ seq: '0' }])
      .mockResolvedValueOnce([{ id: 'ship-2' }]);

    // Real fix: validate userId with parseUserId (as updateDriverLocation
    // does for driverId) and record who created the shipment. Today this
    // silently succeeds with garbage input, proving userId is never
    // checked or stored.
    await expect(
      createShipment(tenantId, 'not-a-uuid-at-all', { senderName: 'A', recipientName: 'B' }),
    ).resolves.toEqual({ id: 'ship-2' });
  });

  it('throws FORBIDDEN when the shipment count limit is reached, before generating a tracking number', async () => {
    mockConfig({ enabled: true, limits: { shipmentCount: 5 } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);

    await expect(
      createShipment(tenantId, userId, { senderName: 'A', recipientName: 'B' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: 'Shipment limits reached for current tier' });
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN when the Logistics vertical is disabled, without querying anything', async () => {
    mockConfig({ enabled: false, limits: { shipmentCount: 500 } });

    await expect(
      createShipment(tenantId, userId, { senderName: 'A', recipientName: 'B' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: 'Logistics vertical is disabled' });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('updateDriverLocation', () => {
  it('upserts the driver location and returns the row', async () => {
    const insertedRow = { id: 'loc-1', driver_id: driverId, lat: 45.9636, lon: -64.8043 };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await updateDriverLocation(tenantId, driverId, 45.9636, -64.8043);

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/); // generated locationId
    expect(params.slice(1)).toEqual([tenantId, driverId, 45.9636, -64.8043]);
  });

  it('rejects an invalid driverId with BAD_REQUEST before touching the database', async () => {
    await expect(updateDriverLocation(tenantId, 'not-a-uuid', 45.9636, -64.8043)).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('BUG: never checks cfg.enabled -- location updates still succeed even with a globally-disabled config on disk', async () => {
    // updateDriverLocation never calls loadConfig() at all, unlike
    // createShipment. Real fix: load config here too and check
    // cfg.enabled, consistent with createShipment.
    mockConfig({ enabled: false, limits: { shipmentCount: 500 } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: 'loc-2' }]);

    await expect(updateDriverLocation(tenantId, driverId, 1, 1)).resolves.toEqual({ id: 'loc-2' });
  });
});

describe('getPublicTracking', () => {
  it('returns the public tracking row for a valid token', async () => {
    const row = { id: 'ship-1', tracking_number: 'SHIP-20260115-0004', status: 'in_transit' };
    mockedWithTenantQuery.mockResolvedValueOnce([row]);

    const result = await getPublicTracking(tenantId, trackingToken);

    expect(result).toEqual(row);
    expect(mockedWithTenantQuery).toHaveBeenCalledWith(expect.stringContaining('FROM shipments'), [trackingToken, tenantId], tenantId);
  });

  it('throws NOT_FOUND for an unknown tracking token', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getPublicTracking(tenantId, trackingToken)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Shipment tracking token not found',
    });
  });

  it('BUG: never checks cfg.enabled -- public tracking remains queryable even with a globally-disabled config on disk', async () => {
    mockConfig({ enabled: false, limits: { shipmentCount: 500 } });
    const row = { id: 'ship-3', tracking_number: 'SHIP-20260115-0005' };
    mockedWithTenantQuery.mockResolvedValueOnce([row]);

    await expect(getPublicTracking(tenantId, trackingToken)).resolves.toEqual(row);
  });
});
