/**
 * @platform/fleet — matches real exports: createVehicle, assignDriver, scheduleMaintenance, getVehicleDetails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN',
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
  },
  parseUserId: (id: string) => id,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import {
  createVehicle,
  assignDriver,
  scheduleMaintenance,
  getVehicleDetails,
  AppError,
  ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DRIVER = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const VEHICLE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('fleet', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
  });

  it('createVehicle inserts vehicle when under limit', async () => {
    const row = { id: VEHICLE, vehicle_number: 'V-1', make: 'Ford' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([row]);

    const result = await createVehicle(TENANT, USER, {
      vehicleNumber: 'V-1',
      make: 'Ford',
      model: 'Transit',
      year: 2024,
    });
    expect(result).toEqual(row);
  });

  it('assignDriver NOT_FOUND when vehicle missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(assignDriver(TENANT, VEHICLE, DRIVER, USER)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('assignDriver BAD_REQUEST when not active', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { status: 'maintenance', assigned_to: null, odometer_km: 1000 },
    ]);
    await expect(assignDriver(TENANT, VEHICLE, DRIVER, USER)).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it('assignDriver CONFLICT when already assigned', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { status: 'active', assigned_to: DRIVER, odometer_km: 1000 },
    ]);
    await expect(assignDriver(TENANT, VEHICLE, DRIVER, USER)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });

  it('assignDriver succeeds and returns assignment_id', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ status: 'active', assigned_to: null, odometer_km: 5000 }])
      .mockResolvedValueOnce([]) // insert assignment
      .mockResolvedValueOnce([{ id: VEHICLE, assigned_to: DRIVER }]);

    const result = await assignDriver(TENANT, VEHICLE, DRIVER, USER);
    expect(result.success).toBe(true);
    expect(result.assignment_id).toBeTruthy();
    expect(result.vehicle.assigned_to).toBe(DRIVER);
  });

  it('scheduleMaintenance inserts maintenance row', async () => {
    const row = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      maintenance_type: 'oil_change',
    };
    mockWithTenantQuery.mockResolvedValueOnce([row]);

    const result = await scheduleMaintenance(TENANT, VEHICLE, {
      maintenanceType: 'oil_change',
      description: '5k service',
      odometerKm: 5000,
    });
    expect(result).toEqual(row);
  });

  it('getVehicleDetails nests assignment and maintenance', async () => {
    const vehicle = { id: VEHICLE, license_plate: 'ABC-123' };
    const assignment = { driver_id: DRIVER };
    const maintenance = [{ maintenance_type: 'oil_change' }];

    mockWithTenantQuery
      .mockResolvedValueOnce([vehicle])
      .mockResolvedValueOnce([assignment])
      .mockResolvedValueOnce(maintenance);

    const result = await getVehicleDetails(TENANT, VEHICLE);
    expect(result.active_assignment).toEqual(assignment);
    expect(result.pending_maintenance).toEqual(maintenance);
  });

  it('getVehicleDetails NOT_FOUND when missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getVehicleDetails(TENANT, VEHICLE)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
