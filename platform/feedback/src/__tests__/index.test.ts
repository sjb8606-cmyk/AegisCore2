import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

// feedback/src/index.ts imports parseUserId via '@platform/utils' but
// AppError/ErrorCode via the relative path '../../utils/src/index' — same
// physical file, two different specifiers. Mock both so neither import
// statement ever reaches the real module.
//
// vi.mock() calls are hoisted above the ENTIRE file, including this const --
// passing utilsMockFactory by reference below hit its temporal dead zone.
// vi.hoisted() hoists the declaration itself right along with vi.mock().
const utilsMockFactory = vi.hoisted(() => () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', INTERNAL: 'INTERNAL', BAD_REQUEST: 'BAD_REQUEST' },
  parseUserId: (id: string) => id,
}));
vi.mock('../../../utils/src/index', utilsMockFactory);
vi.mock('@platform/utils', utilsMockFactory);

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const FB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('feedback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('submitFeedback FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { basicFeedback: true, userVoting: true },
      limits: { feedbackPerDay: 20 },
    }));
    const { FeedbackService } = await load() as any;

    // Real signature: submitFeedback(tenantId, userId, data)
    await expect(FeedbackService.submitFeedback(TENANT, USER, {
      type: 'bug', title: 'Crash on save', description: 'Steps to repro...',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('submitFeedback rejects an invalid type via the real FeedbackSchema', async () => {
    const { FeedbackService } = await load() as any;

    await expect(FeedbackService.submitFeedback(TENANT, USER, {
      type: 'idea', title: 'Dark mode', description: 'Please add it',
    })).rejects.toThrow(); // 'idea' is not in the enum ['bug','feature','ux','general']
  });

  it('submitFeedback inserts the item with the correct field order', async () => {
    const row = { id: FB, title: 'Dark mode', status: 'open' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { FeedbackService } = await load() as any;

    const result = await FeedbackService.submitFeedback(TENANT, USER, {
      type: 'feature', title: 'Dark mode', description: 'Please add it', severity: 3,
    });

    expect(result).toEqual(row);
    const [, params] = mockWithTenantQuery.mock.calls[0];
    expect(params).toEqual([TENANT, USER, 'feature', 'Dark mode', 'Please add it', 3]);
  });

  it('submitFeedback defaults severity to 1 when not provided', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: FB }]);
    const { FeedbackService } = await load() as any;

    await FeedbackService.submitFeedback(TENANT, USER, {
      type: 'bug', title: 'Crash', description: 'Details',
    });

    const [, params] = mockWithTenantQuery.mock.calls[0];
    expect(params[5]).toBe(1);
  });

  it('voteFeedback inserts a vote row using the real VoteSchema shape', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', vote: 1 };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { FeedbackService } = await load() as any;

    // Real VoteSchema: { feedback_id: uuid, vote: literal(1) } — not "value".
    const result = await FeedbackService.voteFeedback(TENANT, USER, {
      feedback_id: FB, vote: 1,
    });

    expect(result).toEqual(row);
  });

  it('voteFeedback returns an acknowledged/duplicate marker on a repeat vote (ON CONFLICT DO NOTHING)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]); // no row returned = conflict, nothing inserted
    const { FeedbackService } = await load() as any;

    const result = await FeedbackService.voteFeedback(TENANT, USER, { feedback_id: FB, vote: 1 });

    expect(result).toEqual({ status: 'acknowledged', duplicate: true });
  });

  it('voteFeedback FORBIDDEN when the userVoting tier is disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { basicFeedback: true, userVoting: false },
      limits: {},
    }));
    const { FeedbackService } = await load() as any;

    await expect(FeedbackService.voteFeedback(TENANT, USER, { feedback_id: FB, vote: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fetchFeedback returns the list for the tenant', async () => {
    const rows = [{ id: FB, title: 'Dark mode' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { FeedbackService } = await load() as any;

    expect(await FeedbackService.fetchFeedback(TENANT)).toEqual(rows);
  });
});
