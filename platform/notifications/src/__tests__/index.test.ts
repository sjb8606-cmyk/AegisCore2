import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));

import { NotificationService, __resetConfigCache } from '../index';
import { withTenantQuery } from '../../../tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfigCache();
  process.env.SENDGRID_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('NotificationService.send — real provider integration', () => {
  it('makes a real SendGrid call and stores the real provider id (the core bug this fixes)', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['x-message-id', 'real-sg-id-123']]),
      text: async () => '',
    }) as any;

    const result = await NotificationService.send(TENANT_ID, {
      recipient: 'test@example.com',
      subject: 'Alert',
      body: 'Something happened',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.success).toBe(true);

    const updateCall = (withTenantQuery as any).mock.calls[1];
    expect(updateCall[0]).toContain("SET status = 'sent'");
    expect(updateCall[1]).toContain('real-sg-id-123');
  });

  it('marks the log failed (never "sent") when SendGrid errors, and rethrows', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'log-2' }])
      .mockResolvedValueOnce([]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    await expect(
      NotificationService.send(TENANT_ID, { recipient: 'test@example.com' }),
    ).rejects.toThrow('SendGrid request failed');

    const updateCall = (withTenantQuery as any).mock.calls[1];
    expect(updateCall[0]).toContain("SET status = 'failed'");
  });

  it('rejects sms before ever touching the DB, since tiers.sms is false by default', async () => {
    await expect(
      NotificationService.send(TENANT_ID, { recipient: '+15555550100', channel: 'sms' }),
    ).rejects.toThrow(/not enabled/i);

    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('throws clearly when SENDGRID_API_KEY is missing, instead of fabricating an id', async () => {
    delete process.env.SENDGRID_API_KEY;
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'log-4' }])
      .mockResolvedValueOnce([]);

    await expect(
      NotificationService.send(TENANT_ID, { recipient: 'test@example.com' }),
    ).rejects.toThrow('SENDGRID_API_KEY');
  });
});
