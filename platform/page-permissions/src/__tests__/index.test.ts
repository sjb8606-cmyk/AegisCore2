import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryPermissionStore,
  roleSatisfies,
  PermissionError,
  loadConfig,
} from '../index';

const T = '11111111-1111-1111-1111-111111111111';
const OWNER = '22222222-2222-2222-2222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';
const USER_C = '44444444-4444-4444-8444-444444444444';
const PAGE = '55555555-5555-4555-8555-555555555555';

describe('page-permissions', () => {
  let store: ReturnType<typeof createMemoryPermissionStore>;

  beforeEach(() => {
    store = createMemoryPermissionStore();
    store.registerPage({ pageId: PAGE, tenantId: T, ownerId: OWNER });
  });

  it('loadConfig enabled', () => {
    expect(loadConfig().enabled).toBe(true);
  });

  it('roleSatisfies ranks', () => {
    expect(roleSatisfies('viewer', 'read')).toBe(true);
    expect(roleSatisfies('viewer', 'write')).toBe(false);
    expect(roleSatisfies('editor', 'write')).toBe(true);
    expect(roleSatisfies('admin', 'share')).toBe(true);
  });

  it('owner has admin access', async () => {
    expect(await store.checkAccess(T, PAGE, OWNER, 'admin')).toBe(true);
    expect(await store.checkAccess(T, PAGE, OWNER, 'write')).toBe(true);
  });

  it('stranger has no access', async () => {
    expect(await store.checkAccess(T, PAGE, USER_B, 'read')).toBe(false);
  });

  it('grant viewer then read works, write fails', async () => {
    await store.grantRole({
      tenantId: T,
      pageId: PAGE,
      userId: USER_B,
      role: 'viewer',
      grantedBy: OWNER,
    });
    expect(await store.checkAccess(T, PAGE, USER_B, 'read')).toBe(true);
    expect(await store.checkAccess(T, PAGE, USER_B, 'write')).toBe(false);
  });

  it('non-admin cannot grant', async () => {
    await store.grantRole({
      tenantId: T,
      pageId: PAGE,
      userId: USER_B,
      role: 'editor',
      grantedBy: OWNER,
    });
    await expect(
      store.grantRole({
        tenantId: T,
        pageId: PAGE,
        userId: USER_C,
        role: 'viewer',
        grantedBy: USER_B,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('revoke removes access; cannot revoke owner', async () => {
    await store.grantRole({
      tenantId: T,
      pageId: PAGE,
      userId: USER_B,
      role: 'editor',
      grantedBy: OWNER,
    });
    await store.revokeRole(T, PAGE, USER_B, OWNER);
    expect(await store.checkAccess(T, PAGE, USER_B, 'read')).toBe(false);
    await expect(store.revokeRole(T, PAGE, OWNER, OWNER)).rejects.toMatchObject({
      code: 'CANNOT_REVOKE_OWNER',
    });
  });

  it('invite accept grants role', async () => {
    const invite = await store.createInvite({
      tenantId: T,
      pageId: PAGE,
      email: 'b@example.com',
      role: 'editor',
      invitedBy: OWNER,
    });
    await store.acceptInvite({
      tenantId: T,
      inviteId: invite.id,
      userId: USER_B,
      email: 'b@example.com',
    });
    expect(await store.checkAccess(T, PAGE, USER_B, 'write')).toBe(true);
  });

  it('invite email mismatch rejected', async () => {
    const invite = await store.createInvite({
      tenantId: T,
      pageId: PAGE,
      email: 'b@example.com',
      role: 'viewer',
      invitedBy: OWNER,
    });
    await expect(
      store.acceptInvite({
        tenantId: T,
        inviteId: invite.id,
        userId: USER_B,
        email: 'other@example.com',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_MISMATCH' });
  });

  it('public link resolves then revoke stops access', async () => {
    const { token, link } = await store.createPublicLink({
      tenantId: T,
      pageId: PAGE,
      role: 'viewer',
      createdBy: OWNER,
    });
    const resolved = await store.resolvePublicToken(token);
    expect(resolved?.pageId).toBe(PAGE);
    expect(resolved?.role).toBe('viewer');

    await store.revokePublicLink(T, link.id, OWNER);
    expect(await store.resolvePublicToken(token)).toBeNull();
  });

  it('public link cannot be admin role', async () => {
    await expect(
      store.createPublicLink({
        tenantId: T,
        pageId: PAGE,
        role: 'admin',
        createdBy: OWNER,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PUBLIC_ROLE' });
  });
});
