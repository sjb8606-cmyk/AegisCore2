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
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      blockWhenStale: true,
      waiverType: 'general_liability',
    }),
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
  publishWaiverVersion,
  signWaiver,
  assertWaiverCurrent,
  getMemberWaiverStatus,
  __resetWaiverVersioningStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const memberId = 'member-1';

describe('waiver-versioning', () => {
  beforeEach(() => {
    __resetWaiverVersioningStore();
    vi.clearAllMocks();
  });

  it('blocks member without signature on active version', async () => {
    await publishWaiverVersion(tenantId, actorId, {
      version: '2026.1',
      title: 'General Liability',
      bodyHash: 'hash-a',
    });
    await expect(assertWaiverCurrent(tenantId, memberId)).rejects.toThrow(
      /must sign/i,
    );
  });

  it('passes after sign', async () => {
    const ver = await publishWaiverVersion(tenantId, actorId, {
      version: '2026.1',
      title: 'General Liability',
      bodyHash: 'hash-a',
    });
    await signWaiver(tenantId, actorId, {
      memberId,
      waiverVersionId: ver.id,
      signatureRef: 'sig-ref-1',
    });
    const result = await assertWaiverCurrent(tenantId, memberId);
    expect(result.current).toBe(true);
    const status = await getMemberWaiverStatus(tenantId, actorId, memberId);
    expect(status.current).toBe(true);
  });

  it('requires re-sign when new version published', async () => {
    const v1 = await publishWaiverVersion(tenantId, actorId, {
      version: '2026.1',
      title: 'v1',
      bodyHash: 'h1',
    });
    await signWaiver(tenantId, actorId, {
      memberId,
      waiverVersionId: v1.id,
      signatureRef: 'sig-1',
    });
    await publishWaiverVersion(tenantId, actorId, {
      version: '2026.2',
      title: 'v2',
      bodyHash: 'h2',
    });
    await expect(assertWaiverCurrent(tenantId, memberId)).rejects.toThrow(
      /2026\.2/,
    );
  });
});
