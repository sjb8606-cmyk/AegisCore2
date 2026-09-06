import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/utils', () => {
  const ErrorCode = { BAD_REQUEST: 'BAD_REQUEST', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND' };
  class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  }
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function parseUserId(userId: unknown): string {
    if (typeof userId === 'string' && UUID_REGEX.test(userId)) return userId;
    throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
  }
  return { AppError, ErrorCode, parseUserId };
});

// Relative to THIS test file (platform/healthcare/src/__tests__/), matching
// the real relative import in platform/healthcare/src/index.ts
// ('../../security/src/kms') resolved from the source file's own location.
vi.mock('../../../security/src/kms', () => ({
  encryptField: vi.fn(),
  decryptField: vi.fn(),
}));

import { withTenantQuery } from '@platform/tenancy';
import { encryptField, decryptField } from '../../../security/src/kms';
import {
  kmsEncrypt, kmsDecrypt, createPatient, getPatient, createNote, signNote, recordConsent, ErrorCode,
} from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PROVIDER_ID = '22222222-2222-2222-2222-222222222222';
const PATIENT_ID = '33333333-3333-3333-3333-333333333333';
const NOTE_ID = '44444444-4444-4444-4444-444444444444';

function mockConfigFile(config: unknown) {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config) as unknown as Buffer);
}
function mockNoConfigFile() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('healthcare: kmsEncrypt / kmsDecrypt', () => {
  it('delegate to the real KMS envelope helpers in platform/security', async () => {
    vi.mocked(encryptField).mockResolvedValue('cipher-text');
    vi.mocked(decryptField).mockResolvedValue('plain-text');

    await expect(kmsEncrypt('hello')).resolves.toBe('cipher-text');
    expect(encryptField).toHaveBeenCalledWith('hello');

    await expect(kmsDecrypt('cipher-text')).resolves.toBe('plain-text');
    expect(decryptField).toHaveBeenCalledWith('cipher-text');
  });
});

describe('healthcare: createPatient', () => {
  it('throws FORBIDDEN when the healthcare module is disabled', async () => {
    mockConfigFile({ enabled: false, tiers: { encryptedRecords: true }, limits: { patientCount: 1000 } });

    await expect(createPatient(TENANT_ID, { first_name: 'Jane' }, PROVIDER_ID))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('throws FORBIDDEN when the HARDENED tier (encryptedRecords) is not enabled', async () => {
    mockConfigFile({ enabled: true, tiers: { encryptedRecords: false }, limits: { patientCount: 1000 } });

    await expect(createPatient(TENANT_ID, { first_name: 'Jane' }, PROVIDER_ID))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('throws BAD_REQUEST for an invalid providerId', async () => {
    mockConfigFile({ enabled: true, tiers: { encryptedRecords: true }, limits: { patientCount: 1000 } });

    await expect(createPatient(TENANT_ID, { first_name: 'Jane' }, 'not-a-uuid'))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws FORBIDDEN once the clinic patient limit is reached', async () => {
    mockConfigFile({ enabled: true, tiers: { encryptedRecords: true }, limits: { patientCount: 2 } });
    vi.mocked(withTenantQuery).mockResolvedValue([{ count: '2' }]);

    await expect(createPatient(TENANT_ID, { first_name: 'Jane' }, PROVIDER_ID))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('success path: encrypts the payload and inserts with a well-formed MRN', async () => {
    mockConfigFile({ enabled: true, tiers: { encryptedRecords: true }, limits: { patientCount: 1000 } });
    vi.mocked(encryptField).mockResolvedValue('encrypted-blob');
    vi.mocked(withTenantQuery).mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('COUNT(*) as count')) return [{ count: '0' }];
      if (sql.includes('INSERT INTO patients')) {
        const [id, , mrn] = params;
        return [{ id, mrn }];
      }
      throw new Error(`Unmocked SQL: ${sql}`);
    });

    const result = await createPatient(TENANT_ID, { first_name: 'Jane', last_name: 'Doe' }, PROVIDER_ID);

    expect(result.mrn).toMatch(/^HC-\d{6}$/);
    expect(encryptField).toHaveBeenCalledWith(JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }));
  });
});

describe('healthcare: getPatient', () => {
  it('throws NOT_FOUND when the patient does not exist', async () => {
    mockNoConfigFile();
    vi.mocked(withTenantQuery).mockResolvedValue([]);

    await expect(getPatient(TENANT_ID, PATIENT_ID)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('success path: decrypts the record and redacts the raw encrypted field', async () => {
    mockNoConfigFile();
    vi.mocked(withTenantQuery).mockResolvedValue([{ id: PATIENT_ID, mrn: 'HC-000001', encrypted_data: 'cipher-blob' }]);
    vi.mocked(decryptField).mockResolvedValue(JSON.stringify({ first_name: 'Jane' }));

    const result = await getPatient(TENANT_ID, PATIENT_ID);

    expect(result.first_name).toBe('Jane');
    expect(result.encrypted_data).toBe('[SECURED_COMPLIANT_VALUE]');
  });
});

describe('healthcare: createNote', () => {
  it('success path: encrypts the note body and inserts', async () => {
    mockNoConfigFile();
    vi.mocked(encryptField).mockResolvedValue('encrypted-note');
    vi.mocked(withTenantQuery).mockResolvedValue([{ id: NOTE_ID, encrypted_body: 'encrypted-note' }]);

    const result = await createNote(TENANT_ID, PATIENT_ID, { body: 'Patient is stable', note_type: 'progress' }, PROVIDER_ID);

    expect(result.id).toBe(NOTE_ID);
    expect(encryptField).toHaveBeenCalledWith(JSON.stringify('Patient is stable'));
  });
});

describe('healthcare: signNote', () => {
  it('throws NOT_FOUND when the note does not exist', async () => {
    vi.mocked(withTenantQuery).mockResolvedValue([]);
    await expect(signNote(TENANT_ID, NOTE_ID, PROVIDER_ID)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('success path: returns success and the signed_at timestamp', async () => {
    vi.mocked(withTenantQuery).mockResolvedValue([{ id: NOTE_ID, signed_at: '2026-09-06T00:00:00.000Z' }]);
    const result = await signNote(TENANT_ID, NOTE_ID, PROVIDER_ID);
    expect(result).toEqual({ success: true, signed_at: '2026-09-06T00:00:00.000Z' });
  });
});

describe('healthcare: recordConsent', () => {
  it('success path: defaults version to v1 and granted to true when not specified', async () => {
    vi.mocked(withTenantQuery).mockImplementation(async (_sql: string, params: any[]) => {
      const [id, , , consentType, version, granted] = params;
      return [{ id, consent_type: consentType, version, granted }];
    });

    const result = await recordConsent(TENANT_ID, PATIENT_ID, { consent_type: 'treatment' });

    expect(result.version).toBe('v1');
    expect(result.granted).toBe(true);
  });

  it('BUG: accepts a garbage patientId with no validation at all', async () => {
    // recordConsent never calls parseUserId/isValidUuid on patientId, unlike
    // createNote (via authorId). A malformed patientId is silently inserted.
    // The real fix: validate patientId is a real UUID before use.
    vi.mocked(withTenantQuery).mockResolvedValue([{ id: 'x', consent_type: 'treatment' }]);

    await expect(recordConsent(TENANT_ID, 'not-a-real-patient-id', { consent_type: 'treatment' }))
      .resolves.toMatchObject({ consent_type: 'treatment' });
  });
});
