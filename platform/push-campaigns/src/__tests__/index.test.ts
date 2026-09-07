/**
 * @platform/push-campaigns
 * Uses module-level cachedConfig → vi.resetModules() when config must change between tests.
 * LIMITATION: sendCampaign only flips status to 'sending' and returns a queue ack — no real provider fan-out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

// Real source imports withTenantQuery and AppError/ErrorCode via relative
// paths, NOT '@platform/tenancy' — only parseUserId genuinely comes from
// the '@platform/utils' package alias.
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('../../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', INTERNAL: 'INTERNAL',
  },
}));

vi.mock('@platform/utils', () => ({
  parseUserId: (id: string) => id,
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.name = 'AppError'; this.code = code; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', INTERNAL: 'INTERNAL',
  },
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const CAMPAIGN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('push-campaigns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('registerDevice upserts device and returns row', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', device_token: 'tok-1', platform: 'ios', is_active: true };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { PushCampaignsService } = await load();
    const svc = PushCampaignsService as any;
    const fn = svc.registerDevice || svc.recordDevice || svc.upsertDevice;
    expect(typeof fn).toBe('function');
    const result = await fn.call(svc, TENANT, USER, { device_token: 'tok-1', platform: 'ios' });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/device_token|push_devices/i);
  });

  it('createCampaign FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { campaigns: true, basicPush: true },
    }));
    const { PushCampaignsService, ErrorCode } = await load();
    await expect(PushCampaignsService.createCampaign(TENANT, {
      name: 'Launch', title: 'Hi', message: 'Welcome',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createCampaign FORBIDDEN when campaigns tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { campaigns: false, basicPush: true },
    }));
    const { PushCampaignsService, ErrorCode } = await load();
    await expect(PushCampaignsService.createCampaign(TENANT, {
      name: 'Launch', title: 'Hi', message: 'Welcome',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Campaign orchestration/i) });
  });

  it('createCampaign inserts draft campaign', async () => {
    const row = { id: CAMPAIGN, name: 'Launch', title: 'Hi', message: 'Welcome', status: 'draft' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { PushCampaignsService } = await load();
    const result = await PushCampaignsService.createCampaign(TENANT, {
      name: 'Launch', title: 'Hi', message: 'Welcome',
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO push_campaigns/i);
  });

  it('sendCampaign NOT_FOUND when campaign missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const { PushCampaignsService, ErrorCode } = await load();
    await expect(PushCampaignsService.sendCampaign(TENANT, CAMPAIGN))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('sendCampaign sets status sending and returns queue ack (LIMITATION: no real fan-out)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: CAMPAIGN, status: 'sending' }]);
    const { PushCampaignsService } = await load();
    const result = await PushCampaignsService.sendCampaign(TENANT, CAMPAIGN);
    expect(result).toEqual({ status: 'sending_queued' });
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/status = 'sending'/i);
  });

  it('fetchCampaigns returns list', async () => {
    const rows = [{ id: CAMPAIGN, name: 'Launch', status: 'draft' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { PushCampaignsService } = await load();
    const result = await PushCampaignsService.fetchCampaigns(TENANT);
    expect(result).toEqual(rows);
  });
});
