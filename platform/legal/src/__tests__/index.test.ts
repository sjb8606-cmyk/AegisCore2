import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

// ── Module-boundary mocks ──────────────────────────────────────────────────

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

// Real path is platform/security/src/kms.ts -- reversible fake so tests can
// assert exactly what plaintext gets "encrypted".
vi.mock('../../../security/src/kms', () => ({
  encryptField: vi.fn(async (value: string) => `ENC(${value})`),
}));

// @platform/utils (AppError/ErrorCode/parseUserId) is NOT mocked -- pure,
// side-effect-free logic; we want its real error codes.

import { withTenantQuery } from '@platform/tenancy';
import { encryptField } from '../../../security/src/kms';
import { ErrorCode } from '@platform/utils';
import {
  createClient,
  checkConflict,
  createMatter,
  createTimeEntry,
  depositTrust,
  kmsEncrypt,
} from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const clientId = '33333333-3333-3333-3333-333333333333';
const matterId = '44444444-4444-4444-4444-444444444444';

const DEFAULT_CONFIG = {
  enabled: true,
  tiers: { encryptedNotes: true, trustAccounting: true },
  limits: { matterCount: 100 },
  billingRate: { default: 22500 }, // deliberately NOT 35000, to expose the hardcoded fallback in createTimeEntry
};

function mockConfig(cfg: unknown) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createClient', () => {
  it('encrypts the address and stores the client, applying documented defaults', async () => {
    mockConfig(DEFAULT_CONFIG);
    const insertedRow = { id: clientId, tenant_id: tenantId, name: 'Jane Doe' };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await createClient(tenantId, { name: 'Jane Doe', address: { city: 'Moncton' } });

    expect(result).toEqual(insertedRow);
    expect(encryptField).toHaveBeenCalledWith(JSON.stringify({ city: 'Moncton' }));

    const [, params] = mockedWithTenantQuery.mock.calls[0];
    // [clientId, tenantId, type, name, email, phone, encrypted, conflict_names]
    expect(params[2]).toBe('individual'); // default type
    expect(params[4]).toBeNull();          // default email
    expect(params[5]).toBeNull();          // default phone
    expect(params[6]).toBe('ENC({"city":"Moncton"})');
    expect(params[7]).toEqual([]);         // default conflict_names
  });

  it('throws FORBIDDEN when the Legal Practice vertical is disabled, without encrypting or querying', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });

    await expect(createClient(tenantId, { name: 'Jane Doe' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Legal Practice vertical is disabled',
    });
    expect(encryptField).not.toHaveBeenCalled();
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('checkConflict', () => {
  it('reports a conflict when the tenant-scoped query returns matches', async () => {
    const rows = [{ name: 'Acme Corp', id: clientId }];
    mockedWithTenantQuery.mockResolvedValueOnce(rows);

    const result = await checkConflict(tenantId, ['Acme Corp']);

    expect(result).toEqual({ conflicts: rows, hasConflict: true });
    expect(mockedWithTenantQuery).toHaveBeenCalledWith(expect.stringContaining('FROM legal_clients'), [tenantId, ['Acme Corp']], tenantId);
  });

  it('reports no conflict when the query returns no matches', async () => {
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    const result = await checkConflict(tenantId, ['Nobody Inc']);
    expect(result).toEqual({ conflicts: [], hasConflict: false });
  });
});

describe('createMatter', () => {
  it('generates a year-scoped matter number and falls back to cfg.billingRate.default', async () => {
    mockConfig(DEFAULT_CONFIG);
    const year = new Date().getFullYear();
    const insertedRow = { id: matterId, tenant_id: tenantId, matter_number: `${year}-0004` };
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '5' }])  // matterCount usage
      .mockResolvedValueOnce([{ seq: '3' }])    // year sequence
      .mockResolvedValueOnce([insertedRow]);    // insert

    const result = await createMatter(tenantId, { client_id: clientId, title: 'Estate Planning' }, userId);

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[2];
    expect(params[2]).toBe(`${year}-0004`);
    expect(params[8]).toBe(22500); // cfg.billingRate.default, correctly respected here
  });

  it('respects an explicit rate_cents over the configured default', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ seq: '0' }])
      .mockResolvedValueOnce([{ id: matterId }]);

    await createMatter(tenantId, { client_id: clientId, title: 'Litigation', rate_cents: 50000 }, userId);

    const [, params] = mockedWithTenantQuery.mock.calls[2];
    expect(params[8]).toBe(50000);
  });

  it('throws FORBIDDEN when the matter capacity limit is reached, before generating a matter number', async () => {
    mockConfig({ ...DEFAULT_CONFIG, limits: { matterCount: 5 } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);

    await expect(createMatter(tenantId, { client_id: clientId, title: 'X' }, userId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Matter capacity limits reached',
    });
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid assignedTo with BAD_REQUEST before touching the database', async () => {
    mockConfig(DEFAULT_CONFIG);
    await expect(createMatter(tenantId, { client_id: clientId, title: 'X' }, 'not-a-uuid')).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('createTimeEntry', () => {
  it('computes amountCents from minutes and an explicit rate_cents', async () => {
    const insertedRow = { id: 'entry-1', minutes: 90, rate_cents: 30000, amount_cents: 45000 };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await createTimeEntry(tenantId, matterId, { minutes: 90, rate_cents: 30000, description: 'Research' }, userId);

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[6]).toBe(45000); // Math.round(90 * 30000 / 60)
  });

  it('BUG: falls back to a hardcoded 35000 rate instead of any configured billing rate', async () => {
    // Note: createTimeEntry never calls loadConfig() at all, so it has no
    // way to honor cfg.billingRate.default even if it wanted to -- unlike
    // createMatter. Real fix: load config here too and fall back to
    // cfg.billingRate.default, consistent with createMatter.
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: 'entry-2' }]);

    await createTimeEntry(tenantId, matterId, { minutes: 60, description: 'Call' }, userId);

    const [, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[5]).toBe(35000);            // rate_cents param -- hardcoded fallback
    expect(params[6]).toBe(35000);            // amountCents = 60 * 35000 / 60
  });

  it('BUG: ignores cfg.enabled -- a time entry is still created even when the Legal Practice vertical is disabled', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: 'entry-3' }]);

    // Unlike createClient/createMatter/depositTrust, createTimeEntry never
    // checks cfg.enabled (in fact it never loads config at all). Real fix:
    // add the same `if (!cfg.enabled) throw ...` guard here.
    await expect(
      createTimeEntry(tenantId, matterId, { minutes: 30, description: 'Filing' }, userId),
    ).resolves.toEqual({ id: 'entry-3' });
  });

  it('rejects an invalid attorneyId with BAD_REQUEST before touching the database', async () => {
    await expect(
      createTimeEntry(tenantId, matterId, { minutes: 30, description: 'Filing' }, 'not-a-uuid'),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('depositTrust', () => {
  it('creates a new trust account when none exists yet', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([])  // SELECT ... FOR UPDATE -- no existing account
      .mockResolvedValueOnce([])  // INSERT trust_accounts
      .mockResolvedValueOnce([]); // INSERT trust_transactions

    const result = await depositTrust(tenantId, matterId, clientId, 10000, 'Initial retainer', userId);

    expect(result.success).toBe(true);
    expect(result.balance).toBe(10000);
    expect(result.account_id).toMatch(/^[0-9a-f-]{36}$/);

    const insertAccountParams = mockedWithTenantQuery.mock.calls[1][1];
    const insertTxnParams = mockedWithTenantQuery.mock.calls[2][1];
    expect(insertAccountParams[0]).toBe(result.account_id);
    expect(insertTxnParams[2]).toBe(result.account_id);
  });

  it('adds to the existing balance when a trust account already exists', async () => {
    mockConfig(DEFAULT_CONFIG);
    const accountId = '55555555-5555-5555-5555-555555555555';
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ id: accountId, balance_cents: '10000' }])
      .mockResolvedValueOnce([]) // UPDATE trust_accounts
      .mockResolvedValueOnce([]); // INSERT trust_transactions

    const result = await depositTrust(tenantId, matterId, clientId, 2500, 'Top-up', userId);

    expect(result).toEqual({ success: true, account_id: accountId, balance: 12500 });
    const updateParams = mockedWithTenantQuery.mock.calls[1][1];
    expect(updateParams).toEqual([12500, accountId, tenantId]);
  });

  it('BUG: the "atomic locked SELECT" provides no real protection -- each step is a separate, independent transaction', async () => {
    // withTenantQuery wraps EVERY call in its own withTenantTransaction
    // (BEGIN...COMMIT per call -- see platform/tenancy/src/rls.ts). The
    // FOR UPDATE lock from the SELECT is released as soon as that single
    // query commits, well before the following UPDATE/INSERT runs in a
    // brand-new transaction. Two concurrent deposits can still race.
    // Real fix: call withTenantTransaction directly and pass one `client`
    // through the SELECT + UPDATE/INSERT + trust_transactions INSERT.
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await depositTrust(tenantId, matterId, clientId, 5000, 'Retainer', userId);

    // Three separate withTenantQuery calls == three separate transactions,
    // not one atomic read-then-write.
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(3);
  });

  it('throws FORBIDDEN when trust accounting is disabled for this tier', async () => {
    mockConfig({ ...DEFAULT_CONFIG, tiers: { ...DEFAULT_CONFIG.tiers, trustAccounting: false } });

    await expect(depositTrust(tenantId, matterId, clientId, 5000, 'Retainer', userId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Trust accounting disabled',
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects an invalid recordedBy with BAD_REQUEST before touching the database', async () => {
    mockConfig(DEFAULT_CONFIG);
    await expect(
      depositTrust(tenantId, matterId, clientId, 5000, 'Retainer', 'not-a-uuid'),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('kmsEncrypt', () => {
  it('delegates to the real KMS envelope helper in platform/security', async () => {
    const cipher = await kmsEncrypt('sensitive-address-json');
    expect(cipher).toBe('ENC(sensitive-address-json)');
    expect(encryptField).toHaveBeenCalledWith('sensitive-address-json');
  });
});
