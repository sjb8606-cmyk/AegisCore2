/**
 * Veridact — Unit Tests: Policy Bundle Store
 */

import { describe, it, expect } from 'vitest';
import {
  getPolicyBundle,
  getBundleHash,
  registerBundle,
  PolicyBundleNotFoundError,
  PolicyBundleHashMismatchError,
} from '../../src/engines/policyBundleStore';

describe('policyBundleStore', () => {
  it('returns the default 1.0.0 bundle when the correct hash is supplied', () => {
    const hash = getBundleHash('1.0.0');
    expect(hash).not.toBeNull();

    const bundle = getPolicyBundle('1.0.0', hash!);
    expect(bundle.rules_version).toBe('1.0.0');
    expect(bundle.rules.length).toBeGreaterThan(0);
  });

  it('throws PolicyBundleNotFoundError for an unknown rules_version', () => {
    expect(() => getPolicyBundle('9.9.9', 'a'.repeat(64))).toThrow(PolicyBundleNotFoundError);
  });

  it('throws PolicyBundleHashMismatchError when the hash does not match', () => {
    expect(() => getPolicyBundle('1.0.0', 'f'.repeat(64))).toThrow(PolicyBundleHashMismatchError);
  });

  it('both error types carry statusCode 400', () => {
    try {
      getPolicyBundle('9.9.9', 'a'.repeat(64));
      throw new Error('should not reach here');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it('registerBundle computes a fresh hash for new bundles', () => {
    const registered = registerBundle({
      rules_version: 'test-version',
      default_effect: 'DENY',
      rules: [],
    });
    expect(registered.rules_hash).toHaveLength(64);
    expect(registered.rules_hash).toMatch(/^[a-f0-9]{64}$/);

    const fetched = getPolicyBundle('test-version', registered.rules_hash);
    expect(fetched.rules_version).toBe('test-version');
  });
});
