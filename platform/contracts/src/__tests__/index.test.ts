import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { ContractsService } from '../index';
import { __setTestPool } from '../../../tenancy/src/rls';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CONTRACT_ID = '33333333-3333-3333-3333-333333333333';
const SIGNATORY_ID = '44444444-4444-4444-4444-444444444444';

const validContract = {
  title: 'NDA',
  body: 'This agreement...',
  signatories: [{ name: 'Sam', email: 'sam@example.com' }],
};

function createFakePool(resultsQueue: any[]) {
  const isAdminStatement = (sql: string) =>
    /^\s*(BEGIN|COMMIT|ROLLBACK|SELECT set_config)/i.test(sql);

  const runQuery = async (sql: string, _params?: any[]) => {
    if (isAdminStatement(sql)) return {};
    if (resultsQueue.length === 0) {
      throw new Error(`createFakePool: no queued result for query: ${sql}`);
    }
    return resultsQueue.shift();
  };

  return {
    query: runQuery,
    connect: async () => ({
      query: runQuery,
      release: () => {},
    }),
  };
}

async function withPool(resultsQueue: any[], fn: () => Promise<any>) {
  __setTestPool(createFakePool(resultsQueue));
  try {
    return await fn();
  } finally {
    __setTestPool(null);
  }
}

async function freshConfig(cfg?: any) {
  vi.resetModules();
  const fs = await import('fs');
  if (cfg) {
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(cfg));
  } else {
    (fs.existsSync as any).mockReturnValueOnce(false);
  }
  const mod = await import('../index');
  return mod.ContractsService;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setTestPool(null);
});

describe('createContract', () => {
  it('blocks when the platform is globally disabled', async () => {
    const Svc = await freshConfig({
      enabled: false,
      tiers: {},
      limits: { contractsPerMonth: 10, signaturesPerContract: 2 },
    });
    await expect(Svc.createContract(TENANT_ID, USER_ID, validContract)).rejects.toThrow(
      'Contracts platform globally disabled'
    );
  });

  it('enforces the monthly contract limit', async () => {
    await withPool([{ rows: [{ count: 10 }] }], async () => {
      await expect(ContractsService.createContract(TENANT_ID, USER_ID, validContract)).rejects.toThrow(
        /Monthly contract limit reached/
      );
    });
  });

  it('enforces the per-contract signatory limit', async () => {
    await withPool([{ rows: [{ count: 0 }] }], async () => {
      const tooManySignatories = {
        ...validContract,
        signatories: [
          { name: 'A', email: 'a@x.com' },
          { name: 'B', email: 'b@x.com' },
          { name: 'C', email: 'c@x.com' },
        ],
      };
      await expect(ContractsService.createContract(TENANT_ID, USER_ID, tooManySignatories)).rejects.toThrow(
        /Signatories count exceeds/
      );
    });
  });

  it('GAP: multiParty tier flag is never enforced — multi-signatory contracts work regardless', async () => {
    await withPool(
      [
        { rows: [{ count: 0 }] },
        { rows: [{ id: CONTRACT_ID }] },
        { rows: [{ id: SIGNATORY_ID, sign_token: 'tok1' }] },
        {},
        { rows: [{ id: 'sig-2', sign_token: 'tok2' }] },
        {},
      ],
      async () => {
        const result = await ContractsService.createContract(TENANT_ID, USER_ID, {
          ...validContract,
          signatories: [{ name: 'A', email: 'a@x.com' }, { name: 'B', email: 'b@x.com' }],
        });
        expect(result.signatories).toHaveLength(2);
      }
    );
  });

  it('creates a contract and inserts a signature_token per signatory via the non-RLS pool', async () => {
    await withPool(
      [
        { rows: [{ count: 0 }] },
        { rows: [{ id: CONTRACT_ID, status: 'draft' }] },
        { rows: [{ id: SIGNATORY_ID, name: 'Sam', sign_token: 'tok1' }] },
        {},
      ],
      async () => {
        const result = await ContractsService.createContract(TENANT_ID, USER_ID, validContract);
        expect(result.contract.status).toBe('draft');
      }
    );
  });
});

describe('recordSignature', () => {
  it('rejects an unknown or expired token', async () => {
    await withPool([{ rows: [] }], async () => {
      await expect(
        ContractsService.recordSignature('bad-token', 'sig-data', { ip: '1.1.1.1', userAgent: 'x' })
      ).rejects.toThrow('Invalid or expired signature token');
    });
  });

  it('rejects when the signatory has already signed via the tenant-scoped re-check', async () => {
    await withPool(
      [
        { rows: [{ tenant_id: TENANT_ID, contract_id: CONTRACT_ID, signatory_id: SIGNATORY_ID }] },
        { rows: [] },
      ],
      async () => {
        await expect(
          ContractsService.recordSignature('tok1', 'sig-data', { ip: '1.1.1.1', userAgent: 'x' })
        ).rejects.toThrow('Invalid or already used signature token');
      }
    );
  });

  it('marks the contract executed once the last signatory signs', async () => {
    await withPool(
      [
        { rows: [{ tenant_id: TENANT_ID, contract_id: CONTRACT_ID, signatory_id: SIGNATORY_ID }] },
        { rows: [{ id: SIGNATORY_ID }] },
        { rows: [{ id: SIGNATORY_ID, signed_at: 'now' }] },
        { rows: [{ unsigned_count: 0 }] },
        { rows: [] },
        {},
      ],
      async () => {
        const result = await ContractsService.recordSignature('tok1', 'sig-data', { ip: '1.1.1.1', userAgent: 'x' });
        expect(result).toEqual({ success: true, contractId: CONTRACT_ID });
      }
    );
  });

  it('does NOT execute the contract while signatories remain unsigned', async () => {
    await withPool(
      [
        { rows: [{ tenant_id: TENANT_ID, contract_id: CONTRACT_ID, signatory_id: SIGNATORY_ID }] },
        { rows: [{ id: SIGNATORY_ID }] },
        { rows: [{ id: SIGNATORY_ID }] },
        {},
        { rows: [{ unsigned_count: 1 }] },
      ],
      async () => {
        await ContractsService.recordSignature('tok1', 'sig-data', { ip: '1.1.1.1', userAgent: 'x' });
      }
    );
  });

  it('deletes the token after use (single-use enforcement)', async () => {
    let deleteWasCalled = false;
    const pool = createFakePool([
      { rows: [{ tenant_id: TENANT_ID, contract_id: CONTRACT_ID, signatory_id: SIGNATORY_ID }] },
      { rows: [{ id: SIGNATORY_ID }] },
      { rows: [{ id: SIGNATORY_ID }] },
      { rows: [{ unsigned_count: 0 }] },
      { rows: [] },
    ]);
    const originalQuery = pool.query;
    pool.query = async (sql: string, params?: any[]) => {
      if (/DELETE FROM signature_tokens/i.test(sql)) {
        deleteWasCalled = true;
        expect(params).toEqual(['tok1']);
        return {};
      }
      return originalQuery(sql, params);
    };
    __setTestPool(pool);
    try {
      await ContractsService.recordSignature('tok1', 'sig-data', { ip: '1.1.1.1', userAgent: 'x' });
      expect(deleteWasCalled).toBe(true);
    } finally {
      __setTestPool(null);
    }
  });
});

describe('cleanupExpiredSignatureTokens', () => {
  it('returns the count of deleted rows', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 7 }), connect: vi.fn() };
    __setTestPool(pool);
    try {
      const result = await ContractsService.cleanupExpiredSignatureTokens();
      expect(result).toBe(7);
    } finally {
      __setTestPool(null);
    }
  });
});

describe('fetchContracts', () => {
  it('returns rows for the tenant', async () => {
    const rows = [{ id: CONTRACT_ID }];
    await withPool([{ rows }], async () => {
      const result = await ContractsService.fetchContracts(TENANT_ID);
      expect(result).toEqual(rows);
    });
  });
});
