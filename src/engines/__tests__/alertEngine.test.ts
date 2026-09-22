import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../db/client', () => ({
  withTenant: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 0,
      }),
    };
    return fn(client);
  }),
}));

import { triggerAlert, listAlerts } from '../alertEngine';
import { SEVERITY_MAP } from '../../types';

describe('alertEngine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggerAlert validates schema, maps severity, inserts row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as any;

    const alert = await triggerAlert({
      tenantId: '11111111-1111-1111-1111-111111111111',
      eventType: 'replay_mismatch',
      actor: { type: 'user', id: 'u1' },
      message: 'mismatch detected',
      linkedReceipt: '22222222-2222-2222-2222-222222222222',
      client,
    });

    expect(alert.severity).toBe(SEVERITY_MAP.replay_mismatch);
    expect(alert.event_type).toBe('replay_mismatch');
    expect(alert.human_message).toMatch(/Investigation required|mismatch/i);
    expect(query).toHaveBeenCalled();
    const sql = String(query.mock.calls[0][0]);
    expect(sql.toLowerCase()).toContain('insert');
  });

  it('triggerAlert uses HIGH severity for hash_mismatch', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const alert = await triggerAlert({
      tenantId: '11111111-1111-1111-1111-111111111111',
      eventType: 'hash_mismatch',
      actor: { type: 'system', id: 'sys' },
      message: 'hash broke',
      client: { query } as any,
    });
    expect(alert.severity).toBe(SEVERITY_MAP.hash_mismatch);
  });
});
