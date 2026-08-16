import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual };
});

import { ingestEvent, verifyChainIntegrity, getAuditLedger } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { GENESIS_HASH, computeChainHash } from '@platform/hash-chain';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audit-log — migrated to the real shared @platform/hash-chain', () => {
  it('chains the first event in a tenant from the real GENESIS_HASH', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'evt-1', event_hash: 'whatever' }]);

    await ingestEvent(TENANT_ID, { event_type: 'test', action: 'created', outcome: 'success' });

    const insertCall = (withTenantQuery as any).mock.calls[1];
    const insertedHash = insertCall[1][14];
    expect(insertedHash).toBe(GENESIS_HASH);
  });

  it('chains a second event from the first event real stored hash, not a fresh genesis', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ event_hash: 'a-real-prior-hash' }])
      .mockResolvedValueOnce([{ id: 'evt-2' }]);

    await ingestEvent(TENANT_ID, { event_type: 'test', action: 'updated', outcome: 'success' });

    const insertCall = (withTenantQuery as any).mock.calls[1];
    expect(insertCall[1][14]).toBe('a-real-prior-hash');
  });

  it('verifyChainIntegrity reports true for a real, correctly-chained sequence', async () => {
    const h1 = computeChainHash(TENANT_ID, 'created', { actorId: '', resourceType: '', resourceId: '', action: 'create', outcome: 'success' }, GENESIS_HASH);
    const h2 = computeChainHash(TENANT_ID, 'updated', { actorId: '', resourceType: '', resourceId: '', action: 'update', outcome: 'success' }, h1);

    (withTenantQuery as any).mockResolvedValueOnce([
      { sequence: 1, event_type: 'created', actor_id: null, resource_type: null, resource_id: null, action: 'create', outcome: 'success', event_hash: h1 },
      { sequence: 2, event_type: 'updated', actor_id: null, resource_type: null, resource_id: null, action: 'update', outcome: 'success', event_hash: h2 },
    ]);

    const result = await verifyChainIntegrity(TENANT_ID);
    expect(result.verified).toBe(true);
    expect(result.total_events_checked).toBe(2);
  });

  it('verifyChainIntegrity DETECTS real tampering — the actual point of this system', async () => {
    const h1 = computeChainHash(TENANT_ID, 'created', { actorId: '', resourceType: '', resourceId: '', action: 'create', outcome: 'success' }, GENESIS_HASH);

    (withTenantQuery as any).mockResolvedValueOnce([
      { sequence: 1, event_type: 'created', actor_id: null, resource_type: null, resource_id: null, action: 'create', outcome: 'failure', event_hash: h1 },
    ]);

    const result = await verifyChainIntegrity(TENANT_ID);
    expect(result.verified).toBe(false);
    expect(result.failed_sequence).toBe(1);
  });

  it('getAuditLedger returns the real events for a tenant', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'evt-1' }, { id: 'evt-2' }]);
    const result = await getAuditLedger(TENANT_ID);
    expect(result.events).toHaveLength(2);
  });
});
