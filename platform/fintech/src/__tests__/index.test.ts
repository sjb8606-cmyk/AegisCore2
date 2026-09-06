import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

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

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() };
});

import { withTenantQuery } from '@platform/tenancy';
import { createAccount, createJournalEntry, voidJournalEntry, getLedgerAccount, ErrorCode } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ACCT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ENTRY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function mockConfigFile(config: unknown) {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config) as unknown as Buffer);
}
function mockNoConfigFile() {
  vi.mocked(fs.existsSync).mockReturnValue(false);
}

function setupTenantQueryMock(opts: {
  countRows?: number;
  seqRows?: number;
  accounts?: Record<string, { type: string; balance_cents?: number }>;
  entryStatus?: { status: string } | undefined;
  journalLines?: Record<string, unknown>[];
} = {}) {
  const { countRows = 0, seqRows = 0, accounts = {}, entryStatus, journalLines = [] } = opts;

  vi.mocked(withTenantQuery).mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes('COUNT(*) as count FROM ledger_accounts')) return [{ count: String(countRows) }];
    if (sql.includes('INSERT INTO ledger_accounts')) {
      const [id, , code, name, type] = params;
      return [{ id, code, name, type }];
    }
    if (sql.includes('COUNT(*) as seq')) return [{ seq: String(seqRows) }];
    if (sql.includes('INSERT INTO journal_entries')) {
      const [id, , entryNumber, description, reference, createdBy] = params;
      return [{ id, entry_number: entryNumber, description, reference, created_by: createdBy, status: 'posted' }];
    }
    if (sql.includes('SELECT type, balance_cents FROM ledger_accounts')) {
      const [accountId] = params;
      const acct = accounts[accountId];
      return acct ? [{ type: acct.type, balance_cents: acct.balance_cents ?? 0 }] : [];
    }
    if (sql.includes('UPDATE ledger_accounts SET balance_cents')) return [];
    if (sql.includes('INSERT INTO journal_lines')) return [];
    if (sql.includes('SELECT status FROM journal_entries')) {
      return entryStatus === undefined ? [] : [entryStatus];
    }
    if (sql.includes('SELECT * FROM journal_lines WHERE entry_id')) return journalLines;
    if (sql.includes("SET status = 'voided'")) return [];
    if (sql.includes('SELECT * FROM ledger_accounts WHERE id')) {
      const [accountId] = params;
      const acct = accounts[accountId];
      return acct ? [{ id: accountId, ...acct }] : [];
    }
    throw new Error(`Unmocked SQL in test: ${sql}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fintech: createAccount', () => {
  it('throws FORBIDDEN when the fintech vertical is disabled', async () => {
    mockConfigFile({ enabled: false, limits: { accountCount: 20 } });
    setupTenantQueryMock();

    await expect(createAccount(TENANT_ID, { code: '1000', name: 'Cash', type: 'asset' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN once the account count limit is reached', async () => {
    mockConfigFile({ enabled: true, limits: { accountCount: 2 } });
    setupTenantQueryMock({ countRows: 2 });

    await expect(createAccount(TENANT_ID, { code: '1000', name: 'Cash', type: 'asset' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('success path: inserts the ledger account', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({ countRows: 0 });

    const result = await createAccount(TENANT_ID, { code: '1000', name: 'Cash', type: 'asset' });

    expect(result).toEqual({ id: expect.any(String), code: '1000', name: 'Cash', type: 'asset' });
  });
});

describe('fintech: createJournalEntry', () => {
  it('throws BAD_REQUEST for unbalanced lines (real double-entry validation)', async () => {
    mockNoConfigFile();
    setupTenantQueryMock();

    await expect(createJournalEntry(TENANT_ID, USER_ID, {
      description: 'Unbalanced',
      lines: [
        { accountId: ACCT_A, type: 'debit', amountCents: 10000 },
        { accountId: ACCT_B, type: 'credit', amountCents: 5000 },
      ],
    })).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('throws NOT_FOUND when a referenced account does not exist', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({ seqRows: 0, accounts: {} });

    await expect(createJournalEntry(TENANT_ID, USER_ID, {
      description: 'Sale',
      lines: [
        { accountId: ACCT_A, type: 'debit', amountCents: 10000 },
        { accountId: ACCT_B, type: 'credit', amountCents: 10000 },
      ],
    })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('success path: applies correct balance direction per account type and formats the entry number', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({
      seqRows: 0,
      accounts: { [ACCT_A]: { type: 'asset' }, [ACCT_B]: { type: 'asset' } },
    });

    const result = await createJournalEntry(TENANT_ID, USER_ID, {
      description: 'Sale',
      lines: [
        { accountId: ACCT_A, type: 'debit', amountCents: 10000 },
        { accountId: ACCT_B, type: 'credit', amountCents: 10000 },
      ],
    });

    expect(result.entry_number).toMatch(/^JE-\d{4}-\d{5}$/);

    const calls = vi.mocked(withTenantQuery).mock.calls;
    const updateCalls = calls.filter(([sql]) => sql.includes('UPDATE ledger_accounts SET balance_cents'));
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][1][0]).toBe('10000');
    expect(updateCalls[1][1][0]).toBe('-10000');
  });
});

describe('fintech: voidJournalEntry', () => {
  it('throws FORBIDDEN when fintech is disabled', async () => {
    mockConfigFile({ enabled: false, limits: { accountCount: 20 } });
    setupTenantQueryMock({ entryStatus: { status: 'posted' } });

    await expect(voidJournalEntry(TENANT_ID, ENTRY_ID, 'test', USER_ID))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('throws NOT_FOUND when the entry does not exist', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({ entryStatus: undefined });
    await expect(voidJournalEntry(TENANT_ID, ENTRY_ID, 'duplicate', USER_ID))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('throws BAD_REQUEST when the entry is not currently posted', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({ entryStatus: { status: 'voided' } });
    await expect(voidJournalEntry(TENANT_ID, ENTRY_ID, 'duplicate', USER_ID))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('success path: creates a balanced reversing entry with flipped debit/credit', async () => {
    mockNoConfigFile();
    setupTenantQueryMock({
      entryStatus: { status: 'posted' },
      journalLines: [
        { account_id: ACCT_A, type: 'debit', amount_cents: '10000', description: 'Original' },
        { account_id: ACCT_B, type: 'credit', amount_cents: '10000', description: 'Original' },
      ],
      accounts: { [ACCT_A]: { type: 'asset' }, [ACCT_B]: { type: 'asset' } },
      seqRows: 0,
    });

    const result = await voidJournalEntry(TENANT_ID, ENTRY_ID, 'duplicate entry', USER_ID);

    expect(result).toBeDefined();
    const calls = vi.mocked(withTenantQuery).mock.calls;
    const lineInserts = calls.filter(([sql]) => sql.includes('INSERT INTO journal_lines'));
    expect(lineInserts).toHaveLength(2);
    expect(lineInserts[0][1][4]).toBe('credit');
    expect(lineInserts[1][1][4]).toBe('debit');
    expect(calls.some(([sql]) => sql.includes("SET status = 'voided'"))).toBe(true);
  });
});

describe('fintech: getLedgerAccount', () => {
  it('throws NOT_FOUND when the account does not exist', async () => {
    setupTenantQueryMock({ accounts: {} });
    await expect(getLedgerAccount(TENANT_ID, ACCT_A)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('success path: returns the account', async () => {
    setupTenantQueryMock({ accounts: { [ACCT_A]: { type: 'asset', balance_cents: 5000 } } });
    const result = await getLedgerAccount(TENANT_ID, ACCT_A);
    expect(result).toMatchObject({ id: ACCT_A, type: 'asset', balance_cents: 5000 });
  });
});
