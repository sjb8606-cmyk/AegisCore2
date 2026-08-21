import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({ enabled: true }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  appendAudit,
  queryAuditLog,
  __resetWormAuditStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('worm-audit', () => {
  beforeEach(() => {
    __resetWormAuditStore();
    vi.clearAllMocks();
  });

  it('appends and chains entries', async () => {
    const a = await appendAudit(tenantId, actorId, {
      action: 'contract.signed',
      entityType: 'liability_contract',
      entityId: 'c1',
      changes: { status: 'signed' },
    });
    const b = await appendAudit(tenantId, actorId, {
      action: 'incident.filed',
      entityType: 'liability_contract',
      entityId: 'c1',
    });
    expect(a.chainHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.previousHash).toBe(a.chainHash);
  });

  it('query filters by entityId', async () => {
    await appendAudit(tenantId, actorId, {
      action: 'x',
      entityType: 'liability_contract',
      entityId: 'c1',
    });
    await appendAudit(tenantId, actorId, {
      action: 'y',
      entityType: 'liability_contract',
      entityId: 'c2',
    });
    const list = await queryAuditLog(tenantId, { entityId: 'c1' });
    expect(list).toHaveLength(1);
    expect(list[0].entityId).toBe('c1');
  });

  it('rejects missing fields', async () => {
    try {
      await appendAudit(tenantId, actorId, {
        action: '',
        entityType: 'x',
        entityId: 'y',
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/required/i);
    }
  });
});
