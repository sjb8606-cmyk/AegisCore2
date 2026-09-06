/**
 * @platform/email-marketing
 * LIMITATION: sendCampaign only flips status to 'sending' — no ESP delivery.
 * cachedConfig → vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', INTERNAL: 'INTERNAL',
  },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('email-marketing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('createCampaign FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { basicEmailSending: true },
      limits: { emailsPerMonth: 10000, campaignsPerDay: 5, templatesPerTenant: 10 },
    }));
    const { EmailMarketingService, ErrorCode } = await load();
    await expect(EmailMarketingService.createCampaign(TENANT, {
      name: 'Launch', subject: 'Hello',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createCampaign inserts draft', async () => {
    const row = { id: CAMPAIGN, name: 'Launch', subject: 'Hello', status: 'draft' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { EmailMarketingService } = await load();
    const result = await EmailMarketingService.createCampaign(TENANT, {
      name: 'Launch', subject: 'Hello',
    });
    expect(result).toEqual(row);
  });

  it('sendCampaign NOT_FOUND when missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const { EmailMarketingService, ErrorCode } = await load();
    await expect(EmailMarketingService.sendCampaign(TENANT, CAMPAIGN))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('sendCampaign returns queue ack (LIMITATION)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: CAMPAIGN, status: 'sending' }]);
    const { EmailMarketingService } = await load();
    const result = await EmailMarketingService.sendCampaign(TENANT, CAMPAIGN);
    expect(result).toEqual({ status: 'sending_queued' });
  });

  it('registerUnsubscribe inserts or returns already_unsubscribed', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ email: 'a@example.com' }]);
    const { EmailMarketingService } = await load();
    const row = await EmailMarketingService.registerUnsubscribe(TENANT, 'a@example.com', 'too many');
    expect(row.email).toBe('a@example.com');

    mockWithTenantQuery.mockResolvedValueOnce([]);
    const dup = await EmailMarketingService.registerUnsubscribe(TENANT, 'a@example.com');
    expect(dup).toEqual({ status: 'already_unsubscribed' });
  });

  it('fetchCampaigns returns list', async () => {
    const rows = [{ id: CAMPAIGN, name: 'Launch', status: 'draft' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { EmailMarketingService } = await load();
    expect(await EmailMarketingService.fetchCampaigns(TENANT)).toEqual(rows);
  });
});
