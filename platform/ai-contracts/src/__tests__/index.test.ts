import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false), // force default config for every test
  readFileSync: vi.fn(),
}));

import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = '22222222-2222-2222-2222-222222222222';

// loadConfig() caches in a module-private closure with no reset hook.
async function freshService() {
  vi.resetModules();
  const mod = await import('../index');
  return mod.AiContractsService;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ingestContract', () => {
  it('rejects raw_text containing an adversarial injection marker', async () => {
    const AiContractsService = await freshService();
    await expect(
      AiContractsService.ingestContract(TENANT_ID, { raw_text: 'clause one adversarial_injection clause two' })
    ).rejects.toThrow('Adversarial prompt injection detected in contract payload');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects empty raw_text before hitting the database', async () => {
    const AiContractsService = await freshService();
    await expect(AiContractsService.ingestContract(TENANT_ID, { raw_text: '' })).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('defaults title and document_type when omitted, and returns queued status', async () => {
    const AiContractsService = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'contract-1' }]);

    const result = await AiContractsService.ingestContract(TENANT_ID, { raw_text: 'This agreement...' });

    expect(result).toEqual({ contractId: 'contract-1', status: 'queued' });
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[1]).toBe('Untitled Contract');
    expect(params[3]).toBe('unclassified');
  });

  it('blocks when the tier disables contractIngestion', async () => {
    vi.resetModules();
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify({ enabled: true, tiers: { contractIngestion: false }, limits: {} })
    );
    const mod = await import('../index');
    await expect(
      mod.AiContractsService.ingestContract(TENANT_ID, { raw_text: 'text' })
    ).rejects.toThrow('Contract ingestion is blocked on current tier');
  });

  it('throws INTERNAL when the insert returns no rows', async () => {
    const AiContractsService = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(
      AiContractsService.ingestContract(TENANT_ID, { raw_text: 'text' })
    ).rejects.toThrow('Failed to ingest contract details');
  });
});

describe('analyzeContract', () => {
  it('throws NOT_FOUND when the contract does not exist for this tenant', async () => {
    const AiContractsService = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(AiContractsService.analyzeContract(TENANT_ID, CONTRACT_ID)).rejects.toThrow('Contract not found');
  });

  it('blocks when the tier disables clauseExtraction', async () => {
    vi.resetModules();
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify({ enabled: true, tiers: { clauseExtraction: false }, limits: {} })
    );
    const mod = await import('../index');
    await expect(mod.AiContractsService.analyzeContract(TENANT_ID, CONTRACT_ID)).rejects.toThrow(
      'Clause extraction features are blocked on current tier'
    );
  });

  // KNOWN DEFECT — documented, not hidden.
  // The function fetches the contract's real raw_text from the database,
  // stores it in `rows`, and then never reads it again. Two wildly different
  // contracts produce byte-identical "analysis" output. This is not clause
  // extraction — it's a fixed literal wearing a `SELECT raw_text` disguise.
  it('DEFECT: returns identical hardcoded analysis regardless of the contract\'s actual raw_text', async () => {
    const AiContractsService = await freshService();

    (withTenantQuery as any).mockResolvedValueOnce([{ raw_text: 'A one-page NDA with no liability clauses at all.' }]);
    const resultA = await AiContractsService.analyzeContract(TENANT_ID, CONTRACT_ID);

    (withTenantQuery as any).mockResolvedValueOnce([{ raw_text: 'A 200-page merger agreement with extensive indemnification.' }]);
    const resultB = await AiContractsService.analyzeContract(TENANT_ID, CONTRACT_ID);

    expect(resultA).toEqual(resultB); // should NOT be true for real clause extraction
    expect(resultA.clauses).toEqual(['Indemnification', 'Limitation of Liability']);
    // TODO(ai-contracts launch blocker): actually parse the fetched raw_text.
  });
});

describe('fetchContracts', () => {
  it('returns whatever rows the query yields', async () => {
    const AiContractsService = await freshService();
    const rows = [{ id: 'c1' }, { id: 'c2' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const result = await AiContractsService.fetchContracts(TENANT_ID);
    expect(result).toEqual(rows);
  });
});
