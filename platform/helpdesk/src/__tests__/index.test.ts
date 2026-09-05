/**
 * @platform/helpdesk — matches real exports
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn();

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
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import {
  createAgent,
  createTicket,
  addMessage,
  autoAssignTicket,
  AppError,
  ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const TICKET = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('helpdesk', () => {
  beforeEach(() => {
    mockWithTenantQuery.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  it('createAgent FORBIDDEN when disabled', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabled: false, tiers: {}, limits: { agentCount: 10 } }),
    );
    await expect(
      createAgent(TENANT, { user_id: USER, name: 'Ada', email: 'ada@ex.com' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createAgent inserts when under limit', async () => {
    const row = { id: AGENT, name: 'Ada' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([row]);
    expect(
      await createAgent(TENANT, { user_id: USER, name: 'Ada', email: 'ada@ex.com' }),
    ).toEqual(row);
  });

  it('createTicket generates ticket number and inserts', async () => {
    const row = { id: TICKET, ticket_number: 'TICK-00001', subject: 'Cannot login' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ next: '0' }]) // generateTicketNumber
      .mockResolvedValueOnce([row]);

    const result = await createTicket(
      TENANT,
      { subject: 'Cannot login', description: 'Help', priority: 'high' },
      USER,
    );
    expect(result).toEqual(row);
  });

  it('addMessage NOT_FOUND when ticket missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(
      addMessage(TENANT, TICKET, 'hello', USER, 'ada@ex.com'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('addMessage inserts and sets first_response_at', async () => {
    const msg = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', body: 'hello' };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ first_response_at: null, assigned_to: null }])
      .mockResolvedValueOnce([msg])
      .mockResolvedValueOnce([]); // first_response update

    expect(await addMessage(TENANT, TICKET, 'hello', USER, 'ada@ex.com')).toEqual(msg);
  });

  it('autoAssignTicket FORBIDDEN when tier off', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabled: true,
        tiers: { slaTracking: true, autoAssignment: false },
        limits: { agentCount: 10 },
      }),
    );
    await expect(autoAssignTicket(TENANT, TICKET)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('autoAssignTicket assigns least-loaded agent', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: AGENT }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await autoAssignTicket(TENANT, TICKET);
    expect(result).toEqual({ success: true, assigned_to_agent_id: AGENT });
  });

  it('autoAssignTicket NOT_FOUND when no agents', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(autoAssignTicket(TENANT, TICKET)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
