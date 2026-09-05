/**
 * @platform/sms-campaigns
 * LIMITATION: sendCampaign only flips status to 'sending' and returns queue ack — no carrier fan-out.
 * GAP: tiers phoneValidation, retryQueue, campaignAnalytics, dlrProcessing, etc. have no code paths.
 * cachedConfig → vi.resetModules() when config must change.
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
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND', INTERNAL: 'INTERNAL',
  },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('sms-campaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      tiers: { basicSmsSending: true },
      limits: { messagesPerSecond: 10, messagesPerTenantPerMonth: 5000, campaignsPerDay: 3 },
    }));
    const { SmsCampaignsService, ErrorCode } = await load();
    await expect(SmsCampaignsService.createCampaign(TENANT, {
      name: 'Promo', message_template: 'Hi {{name}}',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createCampaign rejects empty name via zod', async () => {
    const { SmsCampaignsService } = await load();
    await expect(SmsCampaignsService.createCampaign(TENANT, {
      name: '', message_template: 'Hi',
    })).rejects.toThrow();
  });

  it('createCampaign inserts draft and returns row', async () => {
    const row = { id: CAMPAIGN, name: 'Promo', message_template: 'Hi', status: 'draft' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { SmsCampaignsService } = await load();
    const result = await SmsCampaignsService.createCampaign(TENANT, {
      name: 'Promo', message_template: 'Hi {{name}}',
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO sms_campaigns/i);
  });

  it('sendCampaign NOT_FOUND when missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const { SmsCampaignsService, ErrorCode } = await load();
    await expect(SmsCampaignsService.sendCampaign(TENANT, CAMPAIGN))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('sendCampaign returns queue ack (LIMITATION: no real send)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: CAMPAIGN, status: 'sending' }]);
    const { SmsCampaignsService } = await load();
    const result = await SmsCampaignsService.sendCampaign(TENANT, CAMPAIGN);
    expect(result).toEqual({ status: 'sending_queued' });
  });

  it('registerOptOut inserts or returns already_opted_out', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ phone_number: '+15551234567' }]);
    const { SmsCampaignsService } = await load();
    const row = await SmsCampaignsService.registerOptOut(TENANT, '+15551234567', 'STOP');
    expect(row.phone_number).toBe('+15551234567');

    mockWithTenantQuery.mockResolvedValueOnce([]);
    const dup = await SmsCampaignsService.registerOptOut(TENANT, '+15551234567');
    expect(dup).toEqual({ status: 'already_opted_out' });
  });

  it('fetchCampaigns returns list', async () => {
    const rows = [{ id: CAMPAIGN, name: 'Promo', status: 'draft' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { SmsCampaignsService } = await load();
    expect(await SmsCampaignsService.fetchCampaigns(TENANT)).toEqual(rows);
  });
});
