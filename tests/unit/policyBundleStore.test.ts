/**
 * Veridact — Unit Tests: Policy Bundle Store (DB-backed)
 * Requires a live DATABASE_URL. tenant_id must be real UUID format.
 */

import { describe, it, expect } from 'vitest';
import {
  getPolicyBundle,
  registerBundle,
  PolicyBundleNotFoundError,
  PolicyBundleHashMismatchError,
} from '../../src/engines/policyBundleStore';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('policyBundleStore (DB-backed)', () => {
  it('registers a bundle and retrieves it by tenant + version + hash', async () => {
    const registered = await registerBundle(TENANT_A, {
      rules_version: 'test-v1',
      default_effect: 'DENY',
      rules: [],
    });
    expect(registered.rules_hash).toHaveLength(64);
    expect(registered.rules_hash).toMatch(/^[a-f0-9]{64}$/);

    const fetched = await getPolicyBundle(TENANT_A, 'test-v1', registered.rules_hash);
    expect(fetched.rules_version).toBe('test-v1');
  });

  it('throws PolicyBundleNotFoundError for an unregistered rules_version', async () => {
    await expect(getPolicyBundle(TENANT_A, 'nonexistent-version', 'a'.repeat(64))).rejects.toThrow(
      PolicyBundleNotFoundError
    );
  });

  it('throws PolicyBundleHashMismatchError when the hash does not match', async () => {
    const registered = await registerBundle(TENANT_A, {
      rules_version: 'test-v2',
      default_effect: 'DENY',
      rules: [],
    });
    await expect(getPolicyBundle(TENANT_A, 'test-v2', 'f'.repeat(64))).rejects.toThrow(
      PolicyBundleHashMismatchError
    );
    expect(registered.rules_hash).not.toBe('f'.repeat(64));
  });

  it('re-registering the same tenant + version upserts rather than erroring', async () => {
    await registerBundle(TENANT_A, {
      rules_version: 'test-v3',
      default_effect: 'DENY',
      rules: [],
    });
    const updated = await registerBundle(TENANT_A, {
      rules_version: 'test-v3',
      default_effect: 'ALLOW',
      rules: [],
    });
    expect(updated.default_effect).toBe('ALLOW');

    const fetched = await getPolicyBundle(TENANT_A, 'test-v3', updated.rules_hash);
    expect(fetched.default_effect).toBe('ALLOW');
  });

  it('is tenant-isolated: the same rules_version under a different tenant is a separate bundle', async () => {
    const bundleA = await registerBundle(TENANT_A, {
      rules_version: 'shared-version-name',
      default_effect: 'DENY',
      rules: [],
    });
    const bundleB = await registerBundle(TENANT_B, {
      rules_version: 'shared-version-name',
      default_effect: 'ALLOW',
      rules: [],
    });

    expect(bundleA.default_effect).toBe('DENY');
    expect(bundleB.default_effect).toBe('ALLOW');

    await expect(
      getPolicyBundle(TENANT_B, 'shared-version-name', bundleA.rules_hash)
    ).rejects.toThrow();
  });
});
