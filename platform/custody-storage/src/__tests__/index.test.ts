/**
 * custody-storage tests — memory driver only
 */

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
      driver: 'memory',
      prefix: 'custody',
      region: 'us-east-1',
      limits: { maxBytes: 52_428_800 },
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
  putBlob,
  getBlob,
  deleteBlob,
  blobExists,
  __resetMemoryStore,
  __resetDriverCache,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const otherTenant = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-0000000000aa';

async function expectMessage(fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
    expect.fail('expected function to throw');
  } catch (err: any) {
    expect(String(err?.message ?? err)).toMatch(re);
  }
}

describe('custody-storage (memory driver)', () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetDriverCache();
    vi.clearAllMocks();
  });

  it('puts and gets a blob', async () => {
    const payload = Buffer.from('ciphertext-bytes-001');
    const put = await putBlob(tenantId, actorId, payload, {
      contentType: 'application/octet-stream',
    });

    expect(put.storageKey).toContain(tenantId);
    expect(put.byteSize).toBe(payload.length);
    expect(put.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    const got = await getBlob(tenantId, actorId, put.storageKey);
    expect(got.bytes.equals(payload)).toBe(true);
    expect(got.contentSha256).toBe(put.contentSha256);
  });

  it('exists returns true after put, false after delete', async () => {
    const put = await putBlob(tenantId, actorId, Buffer.from('x'));
    expect(await blobExists(tenantId, actorId, put.storageKey)).toBe(true);

    await deleteBlob(tenantId, actorId, put.storageKey);
    expect(await blobExists(tenantId, actorId, put.storageKey)).toBe(false);
  });

  it('get on missing key throws NOT_FOUND', async () => {
    const key = `custody/${tenantId}/does-not-exist`;
    await expectMessage(() => getBlob(tenantId, actorId, key), /not found/i);
  });

  it('rejects cross-tenant key access', async () => {
    const put = await putBlob(tenantId, actorId, Buffer.from('secret'));
    await expectMessage(
      () => getBlob(otherTenant, actorId, put.storageKey),
      /tenant scope/i,
    );
  });

  it('rejects empty blobs', async () => {
    await expectMessage(
      () => putBlob(tenantId, actorId, Buffer.alloc(0)),
      /empty/i,
    );
  });

  it('delete is idempotent for missing keys in-scope', async () => {
    const key = `custody/${tenantId}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
    const result = await deleteBlob(tenantId, actorId, key);
    expect(result.deleted).toBe(false);
  });
});
