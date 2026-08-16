import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { openEscrow, fundEscrow, disputeEscrow, resolveDispute, getEscrowHistory } from '../index';
import { withTenantQuery, withTenant } from '@platform/tenancy';
import { loadConfig } from '@platform/utils';
import { AppError } from '@platform/utils';
import { GENESIS_HASH, computeChainHash } from '@platform/hash-chain';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const BUYER_ID = '33333333-3333-3333-3333-333333333333';
const SELLER_ID = '44444444-4444-4444-4444-444444444444';

const mockClient = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { openEscrowsPerMonth: 100 } });
  (withTenantQuery as any).mockResolvedValue([{ count: '0' }]);
  (withTenant as any).mockImplementation((_tenantId: string, fn: any) => fn(mockClient));
});

describe('openEscrow — atomic insert + first chained event from GENESIS_HASH', () => {
  it('creates an escrow and appends an "opened" event chained from GENESIS_HASH, all on one client', async () => {
    const escrowRow = { id: 'escrow-1', status: 'open' };
    mockClient.query
      .mockResolvedValueOnce({ rows: [escrowRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await openEscrow(TENANT_ID, ACTOR_ID, {
      referenceId: 'listing-1',
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      amountCents: 5000,
      currency: 'USD',
    });

    expect(result).toEqual(escrowRow);
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    const eventInsertCall = mockClient.query.mock.calls[2];
    expect(eventInsertCall[1]).toContain(GENESIS_HASH);
  });
});

describe('escrow state machine', () => {
  it('allows open -> funded', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'escrow-1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ hash: 'prevhash' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'escrow-1', status: 'funded' }] });

    const result = await fundEscrow(TENANT_ID, ACTOR_ID, 'escrow-1', 'pay-ref-1');
    expect(result.status).toBe('funded');
  });

  it('rejects an invalid transition (open -> released, skipping funded)', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'escrow-1', status: 'open' }] });
    await expect(resolveDispute(TENANT_ID, ACTOR_ID, 'escrow-1', 'release', 'n/a')).rejects.toThrow(/Cannot move escrow/);
  });

  it('throws NOT_FOUND when the escrow does not exist', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    await expect(disputeEscrow(TENANT_ID, ACTOR_ID, 'nonexistent', 'never arrived')).rejects.toThrow(AppError);
  });

  it('allows funded -> disputed -> released via resolveDispute', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'escrow-1', status: 'disputed' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ hash: 'h2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'escrow-1', status: 'released' }] });

    const result = await resolveDispute(TENANT_ID, ACTOR_ID, 'escrow-1', 'release', 'buyer confirmed receipt');
    expect(result.status).toBe('released');
  });
});

describe('getEscrowHistory — real chain verification, not a hardcoded true', () => {
  it('reports verified=true for an intact chain', async () => {
    const openedHash = computeChainHash('escrow-1', 'opened', { a: 1 }, GENESIS_HASH);
    const fundedHash = computeChainHash('escrow-1', 'funded', { b: 2 }, openedHash);

    (withTenantQuery as any).mockResolvedValueOnce([
      { event_type: 'opened', payload_json: { a: 1 }, previous_hash: GENESIS_HASH, hash: openedHash },
      { event_type: 'funded', payload_json: { b: 2 }, previous_hash: openedHash, hash: fundedHash },
    ]);

    const history = await getEscrowHistory(TENANT_ID, 'escrow-1');
    expect(history.verified).toBe(true);
    expect(history.chainBreak).toBeNull();
  });

  it('reports verified=false and identifies the break for a tampered event', async () => {
    const openedHash = computeChainHash('escrow-1', 'opened', { a: 1 }, GENESIS_HASH);

    (withTenantQuery as any).mockResolvedValueOnce([
      { event_type: 'opened', payload_json: { a: 1 }, previous_hash: GENESIS_HASH, hash: openedHash },
      { event_type: 'funded', payload_json: { b: 'TAMPERED' }, previous_hash: openedHash, hash: 'not-the-real-hash' },
    ]);

    const history = await getEscrowHistory(TENANT_ID, 'escrow-1');
    expect(history.verified).toBe(false);
    expect(history.chainBreak?.index).toBe(1);
  });
});
