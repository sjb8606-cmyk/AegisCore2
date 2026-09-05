/**
 * @platform/property-management
 * Real unit-vacancy gate on createLease; ledger nests payments under leases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT',
  },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import {
  createProperty, createUnit, createTenant, createLease, recordRentPayment, getUnitLedger,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROPERTY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UNIT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENANT_PROFILE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const LEASE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('property-management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('createProperty FORBIDDEN when disabled', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false, tiers: {} }));
    await expect(createProperty(TENANT, { name: 'Oak St', address: '1 Oak' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('createProperty inserts and returns row', async () => {
    const row = { id: PROPERTY, name: 'Oak St', address: '1 Oak' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createProperty(TENANT, { name: 'Oak St', address: '1 Oak' });
    expect(result).toEqual(row);
  });

  it('createUnit BAD_REQUEST on invalid property_id', async () => {
    await expect(createUnit(TENANT, { property_id: 'nope', unit_number: '1A' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('createUnit inserts vacant unit', async () => {
    const row = { id: UNIT, property_id: PROPERTY, unit_number: '1A', status: 'vacant' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createUnit(TENANT, { property_id: PROPERTY, unit_number: '1A' });
    expect(result).toEqual(row);
  });

  it('createTenant inserts tenant profile', async () => {
    const row = { id: TENANT_PROFILE, name: 'Jane', email: 'jane@example.com' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createTenant(TENANT, { name: 'Jane', email: 'jane@example.com' });
    expect(result).toEqual(row);
  });

  describe('createLease', () => {
    it('BAD_REQUEST on invalid ids', async () => {
      await expect(createLease(TENANT, {
        unit_id: 'bad', tenant_profile_id: TENANT_PROFILE, start_date: '2026-01-01', rent_amount_cents: 150000,
      })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('NOT_FOUND when unit missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(createLease(TENANT, {
        unit_id: UNIT, tenant_profile_id: TENANT_PROFILE, start_date: '2026-01-01', rent_amount_cents: 150000,
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('CONFLICT when unit not vacant', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ status: 'occupied' }]);
      await expect(createLease(TENANT, {
        unit_id: UNIT, tenant_profile_id: TENANT_PROFILE, start_date: '2026-01-01', rent_amount_cents: 150000,
      })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/not available/i) });
    });

    it('inserts active lease and marks unit occupied', async () => {
      const lease = { id: LEASE, unit_id: UNIT, status: 'active', rent_amount_cents: 150000 };
      mockWithTenantQuery
        .mockResolvedValueOnce([{ status: 'vacant' }])
        .mockResolvedValueOnce([lease])
        .mockResolvedValueOnce([]);
      const result = await createLease(TENANT, {
        unit_id: UNIT, tenant_profile_id: TENANT_PROFILE,
        start_date: '2026-01-01', rent_amount_cents: 150000, deposit_amount_cents: 150000,
      });
      expect(result).toEqual(lease);
      expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/status = 'occupied'/i);
    });
  });

  describe('recordRentPayment / getUnitLedger', () => {
    it('recordRentPayment BAD_REQUEST on invalid lease id', async () => {
      await expect(recordRentPayment(TENANT, 'bad', 150000)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('recordRentPayment inserts payment row', async () => {
      const row = { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', amount_cents: 150000 };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await recordRentPayment(TENANT, LEASE, 150000);
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO pm_rent_payments/i);
    });

    it('getUnitLedger NOT_FOUND when unit missing', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(getUnitLedger(TENANT, UNIT)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('getUnitLedger nests leases with payments', async () => {
      const unit = { id: UNIT, unit_number: '1A', status: 'occupied' };
      const leases = [{ id: LEASE, tenant_name: 'Jane', tenant_email: 'jane@example.com' }];
      const payments = [{ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount_cents: 150000 }];
      mockWithTenantQuery
        .mockResolvedValueOnce([unit])
        .mockResolvedValueOnce(leases)
        .mockResolvedValueOnce(payments);
      const result = await getUnitLedger(TENANT, UNIT);
      expect(result.id).toBe(UNIT);
      expect(result.leases[0].payments).toEqual(payments);
    });
  });
});
