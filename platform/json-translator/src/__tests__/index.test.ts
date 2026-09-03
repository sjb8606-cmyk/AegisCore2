import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';

// ── Module-boundary mocks ──────────────────────────────────────────────────

// config-loader.ts (shared @platform/utils) does `import fs from 'fs'`
// (default import) and walks parent directories looking for /config.
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

// Silence the real pino-backed logger used internally by the shared
// config-loader -- avoids log noise and a real pino/otel init in tests.
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// index.ts imports these via RELATIVE paths, not @platform/* aliases.
vi.mock('../../../metering/src/index', () => ({
  recordUsage: vi.fn(),
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

const tenantId = '11111111-1111-1111-1111-111111111111';

const VALID_CONFIG = {
  enabled: true,
  limits: { maxPayloadSizeKb: 100, maxDepth: 5 },
};

/**
 * The shared @platform/utils `loadConfig()` caches into a module-level
 * `configCache` Map (keyed by feature name), with no reset export. It's
 * also the module that will call `process.exit(1)` if a config file is
 * ever missing or fails schema validation -- so 'fs' is ALWAYS mocked to
 * report a present, valid config here; that crash-prone branch is never
 * exercised (see the DEFECT list -- doing so would kill the test worker).
 *
 * As with any private cache with no reset export: reset the module
 * registry and dynamically re-import the module under test (which
 * transitively re-evaluates a fresh, empty `configCache`) for every test
 * that needs a different config value.
 */
async function freshModule(configJson: unknown) {
  vi.resetModules();

  const fs = await import('fs');
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(configJson));

  const metering = await import('../../../metering/src/index');
  const recordUsage = metering.recordUsage as any;
  recordUsage.mockReset();
  recordUsage.mockResolvedValue(undefined);

  const tenancy = await import('../../../tenancy/src/index');
  const withTenantQuery = tenancy.withTenantQuery as any;
  withTenantQuery.mockReset();

  const mod = await import('../index');
  return { mod, fs, recordUsage, withTenantQuery };
}

describe('processJsonForInsight', () => {
  it('hashes the payload, returns top-level keys only, and records usage', async () => {
    const { mod, recordUsage, withTenantQuery } = await freshModule(VALID_CONFIG);
    const payload = { a: 1, b: { c: 2 } };

    const result = await mod.processJsonForInsight(tenantId, payload);

    const expectedHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const expectedSizeKb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(2);

    expect(result.hash).toBe(expectedHash);
    expect(result.keyCount).toBe(2);
    expect(result.sizeKb).toBe(expectedSizeKb);

    // LIMITATION: "Generate Structural Tree (Simulated)" only returns
    // top-level keys -- 'c' (nested inside 'b') never appears anywhere in
    // the insight. Real fix: recurse into nested objects/arrays if a real
    // structural tree is required, or rename/document this as shallow.
    expect(result.rootKeys).toEqual(['a', 'b']);
    expect(result.rootKeys).not.toContain('c');

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, eventType: 'api_call', quantity: 1 }),
    );

    // GAP: withTenantQuery is imported by this module but never called --
    // no tenant-scoped persistence or lookup of the insight happens at
    // all; tenantId is only ever forwarded to metering.
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('BUG: idempotencyKey embeds Date.now(), so it differs on every call for the identical payload/hash', async () => {
    const { mod, recordUsage } = await freshModule(VALID_CONFIG);
    const payload = { same: 'payload' };

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    await mod.processJsonForInsight(tenantId, payload);
    await mod.processJsonForInsight(tenantId, payload);

    const key1 = recordUsage.mock.calls[0][0].idempotencyKey as string;
    const key2 = recordUsage.mock.calls[1][0].idempotencyKey as string;

    // Real fix: the idempotency key should be derived ONLY from the
    // content hash (e.g. `json-ins:${payloadHash}`), so identical
    // payloads dedupe. As written, the same payload produces two
    // different keys purely because of when it was called.
    expect(key1).toBe(`json-ins:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}:1000`);
    expect(key2).toBe(`json-ins:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}:2000`);
    expect(key1).not.toBe(key2);

    nowSpy.mockRestore();
  });

  it('GAP: maxDepth is configured but never enforced -- deeply nested payloads are never rejected', async () => {
    const { mod } = await freshModule({
      enabled: true,
      limits: { maxPayloadSizeKb: 100, maxDepth: 0 }, // absurdly restrictive on paper
    });
    const deeplyNested = { a: { b: { c: { d: { e: { f: 1 } } } } } };

    // Real fix: walk the payload and reject/measure depth against
    // config.limits.maxDepth. Today, no such check exists at all.
    await expect(mod.processJsonForInsight(tenantId, deeplyNested)).resolves.toBeDefined();
  });

  it('throws FORBIDDEN when disabled, without recording any usage', async () => {
    const { mod, recordUsage } = await freshModule({ enabled: false, limits: { maxPayloadSizeKb: 100, maxDepth: 5 } });

    await expect(mod.processJsonForInsight(tenantId, { a: 1 })).rejects.toMatchObject({
      code: (await import('@platform/utils')).ErrorCode.FORBIDDEN,
      message: 'JSON Inspector disabled',
    });
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the payload exceeds the configured size limit', async () => {
    const { mod, recordUsage } = await freshModule({ enabled: true, limits: { maxPayloadSizeKb: 0.001, maxDepth: 5 } });
    const bigPayload = { data: 'x'.repeat(5000) };

    await expect(mod.processJsonForInsight(tenantId, bigPayload)).rejects.toMatchObject({
      code: (await import('@platform/utils')).ErrorCode.BAD_REQUEST,
    });
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('BUG: throws a raw, unhandled TypeError (not an AppError) for a null payload', async () => {
    const { mod } = await freshModule(VALID_CONFIG);

    // Real fix: validate `payload` is a plain object before calling
    // Object.keys() on it, and throw a proper AppError(BAD_REQUEST) for
    // null/undefined/non-object input instead of leaking a raw TypeError.
    let caught: unknown;
    try {
      await mod.processJsonForInsight(tenantId, null);
      throw new Error('expected processJsonForInsight to throw');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(mod.AppError);
  });
});
