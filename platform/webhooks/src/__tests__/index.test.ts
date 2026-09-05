/**
 * @platform/webhooks — fixed to match real source
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'AppError';
      this.code = code;
    }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN',
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
  },
  parseUserId: (id: string) => id,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import {
  generateSignature,
  createEndpoint,
  deliverWebhook,
  getWebhookLogs,
  AppError,
  ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const EP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('webhooks', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
    vi.unstubAllGlobals();
  });

  it('generateSignature returns stable hmac hex', () => {
    const a = generateSignature('{"a":1}', 'sekrit');
    const b = generateSignature('{"a":1}', 'sekrit');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('createEndpoint rejects non-https urls', async () => {
    await expect(
      createEndpoint(TENANT, USER, { url: 'http://evil.com/hook' }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('createEndpoint inserts when under limit', async () => {
    const row = { id: EP, url: 'https://example.com/hook', secret: 'sekrit' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([row]);

    const result = await createEndpoint(TENANT, USER, {
      url: 'https://example.com/hook',
      secret: 'sekrit',
    });
    expect(result).toEqual(row);
  });

  it('deliverWebhook NOT_FOUND when endpoint missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(
      deliverWebhook(TENANT, EP, 'order.created', { id: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('deliverWebhook posts signed body and returns log row', async () => {
    const endpoint = {
      id: EP,
      url: 'https://example.com/hook',
      secret: 'sekrit',
    };
    const logRow = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      status_code: 200,
      event_type: 'order.created',
    };

    mockWithTenantQuery
      .mockResolvedValueOnce([endpoint])
      .mockResolvedValueOnce([logRow]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        text: async () => 'ok',
      }),
    );

    const result = await deliverWebhook(TENANT, EP, 'order.created', { id: 1 });
    expect(result).toEqual(logRow);
    expect(fetch).toHaveBeenCalled();
    const fetchCall = (fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe('https://example.com/hook');
    expect(fetchCall[1].headers['X-Ruthless-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('deliverWebhook logs failure when fetch throws', async () => {
    const endpoint = {
      id: EP,
      url: 'https://example.com/hook',
      secret: 'sekrit',
    };
    const logRow = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      status_code: 500,
      error_message: 'network down',
    };

    mockWithTenantQuery
      .mockResolvedValueOnce([endpoint])
      .mockResolvedValueOnce([logRow]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const result = await deliverWebhook(TENANT, EP, 'ping', {});
    expect(result.status_code).toBe(500);
    // error_message is the 8th SQL param (index 7)
    expect(mockWithTenantQuery.mock.calls[1][1][7]).toBe('network down');
  });

  it('getWebhookLogs returns ordered rows', async () => {
    const rows = [
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', event_type: 'ping' },
    ];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    expect(await getWebhookLogs(TENANT, EP)).toEqual(rows);
  });
});
