import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rotateSecret, testRotation, getSecret, invalidateSecretCache } from '../vault';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  invalidateSecretCache();
  process.env.VAULT_TOKEN = 'test-token';
  delete process.env.VAULT_ROLE_ID;
  delete process.env.VAULT_SECRET_ID;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('rotateSecret — no more silent stub success', () => {
  it('FIXED: fails loudly (success: false) with no newValue, instead of always returning success', async () => {
    const result = await rotateSecret('db/creds');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no generic Vault rotation endpoint|newValue/i);
  });

  it('actually POSTs the new value to Vault when a real newValue is given', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;

    const result = await rotateSecret('db/creds', { password: 'new-real-password' });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/data/db/creds'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: { password: 'new-real-password' } }),
      }),
    );
  });

  it('reports failure (not fabricated success) when the real Vault write fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'permission denied' }) as any;

    const result = await rotateSecret('db/creds', { password: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });
});

describe('testRotation — real round-trip check', () => {
  it('confirms rotation by reading back a genuinely new marker value', async () => {
    let stored = { password: 'old-password' };

    global.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'POST') {
        stored = JSON.parse(opts.body).data;
        return { ok: true, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { data: stored } }),
      };
    }) as any;

    const ok = await testRotation('db/creds');
    expect(ok).toBe(true);
  });
});
