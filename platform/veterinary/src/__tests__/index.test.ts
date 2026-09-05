/**
 * @platform/veterinary
 * Medical ledger append on patient/vaccination/treatment; timeline aggregates all three.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  registerAnimalPatient, addVaccinationRecord, createTreatmentPlan, getPatientTimeline,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const PATIENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('veterinary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registerAnimalPatient FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: {}, limits: {}, thresholds: {},
    }));
    await expect(registerAnimalPatient(TENANT, USER, { name: 'Rex', species: 'canine' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('registerAnimalPatient inserts patient + ledger event', async () => {
    const row = { id: PATIENT, name: 'Rex', species: 'canine' };
    mockWithTenantQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const result = await registerAnimalPatient(TENANT, USER, {
      name: 'Rex', species: 'canine', breed: 'Lab',
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/vet_medical_events/i);
    expect(mockWithTenantQuery.mock.calls[1][1][3]).toBe('PATIENT_REGISTRATION');
  });

  it('addVaccinationRecord BAD_REQUEST on invalid patient id', async () => {
    await expect(addVaccinationRecord(TENANT, 'bad', { vaccine_name: 'Rabies' }, USER))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('addVaccinationRecord inserts vaccination + ledger', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', vaccine_name: 'Rabies' };
    mockWithTenantQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const result = await addVaccinationRecord(TENANT, PATIENT, {
      vaccine_name: 'Rabies', administered_at: '2026-01-01', next_due_at: '2027-01-01',
    }, USER);
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[1][1][3]).toBe('VACCINATION_ADMINISTERED');
  });

  it('createTreatmentPlan inserts treatment + ledger', async () => {
    const row = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', title: 'Dental', status: 'active' };
    mockWithTenantQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const result = await createTreatmentPlan(TENANT, PATIENT, {
      title: 'Dental', diagnostic_notes: 'Grade 2 tartar',
    }, USER);
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[1][1][3]).toBe('TREATMENT_STARTED');
  });

  it('getPatientTimeline NOT_FOUND / aggregates all records', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getPatientTimeline(TENANT, PATIENT)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const patient = { id: PATIENT, name: 'Rex' };
    const vaccinations = [{ vaccine_name: 'Rabies' }];
    const treatments = [{ title: 'Dental' }];
    const events = [{ event_type: 'PATIENT_REGISTRATION' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([patient])
      .mockResolvedValueOnce(vaccinations)
      .mockResolvedValueOnce(treatments)
      .mockResolvedValueOnce(events);
    const result = await getPatientTimeline(TENANT, PATIENT);
    expect(result.vaccinations).toEqual(vaccinations);
    expect(result.treatments).toEqual(treatments);
    expect(result.medical_events).toEqual(events);
  });
});
