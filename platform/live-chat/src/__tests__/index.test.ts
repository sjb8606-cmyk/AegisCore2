import { describe, it, expect, vi } from 'vitest';

// ── Module-boundary mocks ──────────────────────────────────────────────────

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

// index.ts imports withTenantQuery via a RELATIVE path, not @platform/tenancy.
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/utils (parseUserId) and the relative ../../utils/src/index
// (AppError/ErrorCode) are NOT mocked -- pure, side-effect-free logic.

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '22222222-2222-2222-2222-222222222222';
const conversationId = '33333333-3333-3333-3333-333333333333';

const DEFAULT_CONFIG = {
  enabled: true,
  tiers: {
    basicChat: true,
    realTimeMessaging: true,
    conversationHistory: true,
    agentRouting: true,
    chatWidget: true,
    fileAttachments: false, // deliberately false -- see GAP test below
    offlineMessages: true,
    typingIndicators: true,
    aiAssistSuggestions: false,
    conversationTagging: true,
    escalationRules: false,
    slaTracking: false,
    multiChannelSync: false,
    auditTrail: true,
  },
  limits: {
    messagesPerSecond: 5,
    activeConversations: 100,
    agentsPerTenant: 10,
  },
};

/**
 * `loadConfig()` caches into a module-level `cachedConfig` with no reset
 * export. Reset the module registry and re-import the config-reading
 * dependency ('fs') plus the module under test fresh for every test.
 */
async function freshModule(configJson: unknown | false = DEFAULT_CONFIG) {
  vi.resetModules();

  const fs = await import('fs');
  if (configJson === false) {
    (fs.existsSync as any).mockReturnValue(false);
  } else {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(configJson));
  }

  const tenancy = await import('../../../tenancy/src/index');
  const withTenantQuery = tenancy.withTenantQuery as any;
  withTenantQuery.mockReset();

  const mod = await import('../index');
  return { mod, fs, withTenantQuery };
}

describe('LiveChatService.createConversation', () => {
  it('creates a conversation using the explicit userId param', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const insertedRow = { id: conversationId, tenant_id: tenantId, priority: 3, status: 'open' };
    withTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await mod.LiveChatService.createConversation(tenantId, { priority: 3 }, userId);

    expect(result).toEqual(insertedRow);
    expect(withTenantQuery).toHaveBeenCalledWith(expect.any(String), [tenantId, userId, 3], tenantId);
  });

  it('falls back to conversation.user_id and defaults priority to 1 when no explicit userId is given', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([{ id: conversationId, priority: 1 }]);

    await mod.LiveChatService.createConversation(tenantId, { user_id: userId });

    expect(withTenantQuery).toHaveBeenCalledWith(expect.any(String), [tenantId, userId, 1], tenantId);
  });

  it('BUG: anonymous/widget conversations always fail -- user id is optional in the schema but mandatory in practice', async () => {
    const { mod, withTenantQuery } = await freshModule();

    // Both `userId` (optional param) and `conversation.user_id` (optional
    // schema field) suggest anonymous/widget chat should be supported, but
    // parseUserId(userId || conversation.user_id) is called unconditionally
    // with no way to represent "no user". Real fix: only call parseUserId
    // when a user id is actually supplied, and allow a NULL user_id column
    // for anonymous visitors.
    await expect(mod.LiveChatService.createConversation(tenantId, {})).rejects.toMatchObject({
      code: mod.ErrorCode.BAD_REQUEST,
    });
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('GAP: messagesPerSecond/activeConversations/agentsPerTenant limits are configured but never enforced', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      limits: { messagesPerSecond: 0, activeConversations: 0, agentsPerTenant: 0 },
    });
    withTenantQuery.mockResolvedValueOnce([{ id: conversationId }]);

    // Real fix: none of these limits are read anywhere in this file.
    // Setting them to the most restrictive possible value (0) has zero
    // effect on conversation creation.
    const result = await mod.LiveChatService.createConversation(tenantId, { user_id: userId });
    expect(result).toEqual({ id: conversationId });
  });

  it('throws FORBIDDEN when live chat is globally disabled', async () => {
    const { mod } = await freshModule({ ...DEFAULT_CONFIG, enabled: false });
    await expect(mod.LiveChatService.createConversation(tenantId, { user_id: userId })).rejects.toMatchObject({
      code: mod.ErrorCode.FORBIDDEN,
      message: 'Live chat is globally disabled',
    });
  });

  it('throws FORBIDDEN when the basicChat tier is disabled', async () => {
    const { mod } = await freshModule({ ...DEFAULT_CONFIG, tiers: { ...DEFAULT_CONFIG.tiers, basicChat: false } });
    await expect(mod.LiveChatService.createConversation(tenantId, { user_id: userId })).rejects.toMatchObject({
      code: mod.ErrorCode.FORBIDDEN,
      message: 'Live chat features are blocked on current tier',
    });
  });

  it('throws INTERNAL when the insert unexpectedly returns no rows', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    await expect(mod.LiveChatService.createConversation(tenantId, { user_id: userId })).rejects.toMatchObject({
      code: mod.ErrorCode.INTERNAL,
      message: 'Failed to initialize conversation',
    });
  });

  it('rejects invalid conversation data (priority out of range) via zod', async () => {
    const { mod } = await freshModule();
    await expect(
      mod.LiveChatService.createConversation(tenantId, { user_id: userId, priority: 6 }),
    ).rejects.toThrow();
  });
});

describe('LiveChatService.sendMessage', () => {
  it('sends a message with attachments serialized as JSON', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const insertedRow = { id: 'msg-1', message: 'Hi there' };
    withTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await mod.LiveChatService.sendMessage(
      tenantId,
      { conversation_id: conversationId, message: 'Hi there', attachments: ['https://example.com/f.png'] },
      userId,
      'user',
    );

    expect(result).toEqual(insertedRow);
    const [, params] = withTenantQuery.mock.calls[0];
    expect(params).toEqual([
      tenantId,
      conversationId,
      userId,
      'user',
      'Hi there',
      JSON.stringify(['https://example.com/f.png']),
    ]);
  });

  it('GAP: fileAttachments tier flag is never checked -- attachments are accepted even when the tier is disabled', async () => {
    const { mod, withTenantQuery } = await freshModule({
      ...DEFAULT_CONFIG,
      tiers: { ...DEFAULT_CONFIG.tiers, fileAttachments: false },
    });
    withTenantQuery.mockResolvedValueOnce([{ id: 'msg-2' }]);

    // Real fix: check config.tiers.fileAttachments before accepting a
    // non-empty attachments array. Today nothing gates this at all.
    const result = await mod.LiveChatService.sendMessage(
      tenantId,
      { conversation_id: conversationId, message: 'See attached', attachments: ['https://example.com/f.png'] },
      userId,
      'user',
    );
    expect(result).toEqual({ id: 'msg-2' });
  });

  it('throws FORBIDDEN when live chat is globally disabled', async () => {
    const { mod } = await freshModule({ ...DEFAULT_CONFIG, enabled: false });
    await expect(
      mod.LiveChatService.sendMessage(tenantId, { conversation_id: conversationId, message: 'Hi' }, userId, 'user'),
    ).rejects.toMatchObject({ code: mod.ErrorCode.FORBIDDEN, message: 'Live chat is globally disabled' });
  });

  it('rejects an invalid senderId with BAD_REQUEST before touching the database', async () => {
    const { mod, withTenantQuery } = await freshModule();
    await expect(
      mod.LiveChatService.sendMessage(tenantId, { conversation_id: conversationId, message: 'Hi' }, 'not-a-uuid', 'user'),
    ).rejects.toMatchObject({ code: mod.ErrorCode.BAD_REQUEST });
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('rejects an empty message via zod', async () => {
    const { mod } = await freshModule();
    await expect(
      mod.LiveChatService.sendMessage(tenantId, { conversation_id: conversationId, message: '' }, userId, 'user'),
    ).rejects.toThrow();
  });

  it('throws INTERNAL when the insert unexpectedly returns no rows', async () => {
    const { mod, withTenantQuery } = await freshModule();
    withTenantQuery.mockResolvedValueOnce([]);
    await expect(
      mod.LiveChatService.sendMessage(tenantId, { conversation_id: conversationId, message: 'Hi' }, userId, 'user'),
    ).rejects.toMatchObject({ code: mod.ErrorCode.INTERNAL, message: 'Failed to send message' });
  });
});

describe('LiveChatService.fetchConversations', () => {
  it('returns the tenant-scoped rows as-is', async () => {
    const { mod, withTenantQuery } = await freshModule();
    const rows = [{ id: conversationId, status: 'open' }];
    withTenantQuery.mockResolvedValueOnce(rows);

    const result = await mod.LiveChatService.fetchConversations(tenantId);

    expect(result).toEqual(rows);
    expect(withTenantQuery).toHaveBeenCalledWith(expect.stringContaining('FROM chat_conversations'), [tenantId], tenantId);
  });

  it('BUG: never checks config.enabled -- conversations can still be read while live chat is globally disabled', async () => {
    const { mod, withTenantQuery } = await freshModule({ ...DEFAULT_CONFIG, enabled: false });
    const rows = [{ id: conversationId, status: 'open' }];
    withTenantQuery.mockResolvedValueOnce(rows);

    // Unlike createConversation/sendMessage, fetchConversations never
    // loads config at all. Real fix: add the same enabled-check here.
    const result = await mod.LiveChatService.fetchConversations(tenantId);
    expect(result).toEqual(rows);
  });
});
