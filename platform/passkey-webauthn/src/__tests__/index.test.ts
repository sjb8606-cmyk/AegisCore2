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
      rpName: 'AegisCore',
      rpId: 'localhost',
      allowedOrigins: ['http://localhost:3000'],
      challengeTtlSeconds: 300,
      allowedDeviceTypes: ['any'],
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
  beginRegistration,
  finishRegistration,
  beginLogin,
  finishLogin,
  listAuthenticators,
  __resetPasskeyStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const userId = 'user-passkey-1';

describe('passkey-webauthn', () => {
  beforeEach(() => {
    __resetPasskeyStore();
    vi.clearAllMocks();
  });

  it('registers and logs in with passkey', async () => {
    const reg = await beginRegistration(tenantId, actorId, {
      userId,
      userName: 'alice@example.com',
    });
    expect(reg.challenge).toBeTruthy();
    expect(reg.rp.id).toBe('localhost');

    const auth = await finishRegistration(tenantId, actorId, {
      challenge: reg.challenge,
      credentialId: 'cred-abc',
      publicKey: 'pk-mock',
      deviceType: 'platform',
      transports: ['internal'],
    });
    expect(auth.userId).toBe(userId);

    const login = await beginLogin(tenantId, actorId, { userId });
    expect(login.allowCredentials.length).toBe(1);

    const session = await finishLogin(tenantId, actorId, {
      challenge: login.challenge,
      credentialId: 'cred-abc',
      counter: 1,
      signature: 'sig-mock',
    });
    expect(session.userId).toBe(userId);
    expect(session.sessionHint).toBeTruthy();

    const list = await listAuthenticators(tenantId, userId);
    expect(list).toHaveLength(1);
  });

  it('rejects finish with unknown challenge', async () => {
    await expect(
      finishRegistration(tenantId, actorId, {
        challenge: 'nope',
        credentialId: 'x',
        publicKey: 'y',
      }),
    ).rejects.toThrow(/Invalid challenge/i);
  });

  it('detects counter rollback', async () => {
    const reg = await beginRegistration(tenantId, actorId, {
      userId,
      userName: 'bob',
    });
    await finishRegistration(tenantId, actorId, {
      challenge: reg.challenge,
      credentialId: 'cred-2',
      publicKey: 'pk',
    });
    const login1 = await beginLogin(tenantId, actorId, { userId });
    await finishLogin(tenantId, actorId, {
      challenge: login1.challenge,
      credentialId: 'cred-2',
      counter: 5,
    });
    const login2 = await beginLogin(tenantId, actorId, { userId });
    await expect(
      finishLogin(tenantId, actorId, {
        challenge: login2.challenge,
        credentialId: 'cred-2',
        counter: 2,
      }),
    ).rejects.toThrow(/counter rollback/i);
  });
});
