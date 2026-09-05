import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { withTenantQuery } from '../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const FORUM_ID = '33333333-3333-3333-3333-333333333333';
const THREAD_ID = '44444444-4444-4444-4444-444444444444';

async function freshService(cfg?: any) {
  vi.resetModules();
  if (cfg) {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValueOnce(true);
    (fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(cfg));
  }
  const mod = await import('../index');
  return mod.CommunityService;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createThread', () => {
  it('blocks when the platform is globally disabled', async () => {
    const svc = await freshService({ enabled: false, tiers: {}, limits: {} });
    await expect(
      svc.createThread(TENANT_ID, USER_ID, { forum_id: FORUM_ID, title: 'Hi', content: 'Hello' })
    ).rejects.toThrow('Community platform is globally disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('blocks when the threads tier is off', async () => {
    const svc = await freshService({ enabled: true, tiers: { threads: false }, limits: {} });
    await expect(
      svc.createThread(TENANT_ID, USER_ID, { forum_id: FORUM_ID, title: 'Hi', content: 'Hello' })
    ).rejects.toThrow('Thread creation is blocked on current tier');
  });

  it('rejects an invalid forum_id via schema validation', async () => {
    const svc = await freshService();
    await expect(
      svc.createThread(TENANT_ID, USER_ID, { forum_id: 'not-a-uuid', title: 'Hi', content: 'Hello' })
    ).rejects.toThrow();
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('creates a thread and returns the inserted row', async () => {
    const svc = await freshService();
    const row = { id: THREAD_ID, title: 'Hi' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await svc.createThread(TENANT_ID, USER_ID, { forum_id: FORUM_ID, title: 'Hi', content: 'Hello' });
    expect(result).toEqual(row);
  });
});

describe('createComment', () => {
  it('blocks when the nestedComments tier is off', async () => {
    const svc = await freshService({ enabled: true, tiers: { nestedComments: false }, limits: {} });
    await expect(
      svc.createComment(TENANT_ID, USER_ID, { thread_id: THREAD_ID, content: 'reply' })
    ).rejects.toThrow('Comment indexing is blocked on current tier');
  });

  it('allows an optional parent_id to be omitted for a top-level comment', async () => {
    const svc = await freshService();
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'comment-1' }]);
    await svc.createComment(TENANT_ID, USER_ID, { thread_id: THREAD_ID, content: 'reply' });
    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[2]).toBeNull();
  });
});

describe('voteContent', () => {
  it('blocks when the voting tier is off', async () => {
    const svc = await freshService({ enabled: true, tiers: { voting: false }, limits: {} });
    await expect(svc.voteContent(TENANT_ID, USER_ID, THREAD_ID, 'thread', 1)).rejects.toThrow(
      'Voting systems are blocked on current tier'
    );
  });

  it('upserts a vote and returns the row', async () => {
    const svc = await freshService();
    const row = { id: 'vote-1', vote: 1 };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await svc.voteContent(TENANT_ID, USER_ID, THREAD_ID, 'thread', 1);
    expect(result).toEqual(row);
  });

  // GAP — documented, not hidden. Unlike forum_id/thread_id (validated via
  // zod .uuid()) and userId (validated via parseUserId()), targetId here is
  // passed straight into `$3::uuid` with no prior validation. A malformed
  // targetId will surface as a raw Postgres type-cast error, not a clean
  // AppError, unlike every other ID in this file.
  it('GAP: targetId is never validated before being cast to ::uuid, unlike every other ID here', async () => {
    const svc = await freshService();
    (withTenantQuery as any).mockRejectedValueOnce(new Error('invalid input syntax for type uuid: "not-a-uuid"'));
    await expect(svc.voteContent(TENANT_ID, USER_ID, 'not-a-uuid', 'thread', 1)).rejects.toThrow(
      'invalid input syntax for type uuid'
    );
    // TODO(community): validate targetId with z.string().uuid() or parseUserId()
    // before it reaches the query, same as every other ID field in this file.
  });
});

describe('fetchForums', () => {
  it('returns forum rows for the tenant', async () => {
    const rows = [{ id: FORUM_ID, name: 'General' }];
    (withTenantQuery as any).mockResolvedValueOnce(rows);
    const svc = await freshService();
    const result = await svc.fetchForums(TENANT_ID);
    expect(result).toEqual(rows);
  });
});

describe('setupMockForum', () => {
  it('returns the existing forum instead of creating a duplicate when one already exists', async () => {
    const existing = { id: FORUM_ID, name: 'General Discussion' };
    (withTenantQuery as any).mockResolvedValueOnce([existing]);
    const svc = await freshService();
    const result = await svc.setupMockForum(TENANT_ID);
    expect(result).toEqual(existing);
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('creates a default "General Discussion" forum when none exists yet', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: FORUM_ID, name: 'General Discussion' }]);
    const svc = await freshService();
    const result = await svc.setupMockForum(TENANT_ID);
    expect(result.name).toBe('General Discussion');
    expect(withTenantQuery).toHaveBeenCalledTimes(2);
  });
});
