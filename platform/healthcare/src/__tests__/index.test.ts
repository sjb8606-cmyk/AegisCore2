/**
 * @platform/healthcare
 * LIMITATION: kmsEncrypt/kmsDecrypt local stand-ins for PHI fields.
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
  kmsEncrypt, kmsDecrypt, createPatient, createEncounter, getPatientChart, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PATIENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('healthcare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kmsEncrypt/kmsDecrypt round-trip', async () => {
    const c = await kmsEncrypt('PHI-data');
    expect(await kmsDecrypt(c)).toBe('PHI-data');
  });

  it('createPatient inserts patient (PHI fields may be encrypted)', async () => {
    const row = { id: PATIENT, mrn: 'MRN-1' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createPatient(TENANT, {
      first_name: 'Jane', last_name: 'Doe', dob: '1990-01-01',
    });
    expect(result).toEqual(row);
  });

  it('createEncounter inserts encounter for patient', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', patient_id: PATIENT, type: 'office_visit' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createEncounter(TENANT, {
      patient_id: PATIENT, type: 'office_visit', notes: 'Annual physical',
    });
    expect(result).toEqual(row);
  });

  it('getPatientChart NOT_FOUND / returns chart', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getPatientChart(TENANT, PATIENT)).rejects.toMatchObject({ code: expect.any(String) });

    const patient = { id: PATIENT, mrn: 'MRN-1' };
    mockWithTenantQuery.mockResolvedValue([patient]);
    const result = await getPatientChart(TENANT, PATIENT);
    expect(result).toBeDefined();
  });
});
