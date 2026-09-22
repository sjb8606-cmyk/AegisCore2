import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockGetTierConfig = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/entitlements', () => ({
  getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args),
}));

vi.mock('@platform/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@platform/utils');
  return { ...actual };
});

import { registerCommand, listCommands, executeCommand, listExecutions } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const CMD_ID = '33333333-3333-3333-3333-333333333333';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      registerCommands: true,
      executeCommands: true,
      commandHistory: true,
      dangerousCommands: false,
      ...(over.tiers as object),
    },
    limits: {
      maxCommandsPerTenant: 100,
      maxHistoryPerTenant: 1000,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('registerCommand', () => {
  it('registers a command', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: CMD_ID, name: 'ping' }]);
    const row = await registerCommand(TENANT, {
      name: 'ping',
      handler_key: 'core.ping',
      description: 'Ping',
    }, ACTOR);
    expect(row.name).toBe('ping');
  });

  it('rejects invalid name', async () => {
    await expect(
      registerCommand(TENANT, { name: 'Bad Name', handler_key: 'x' }, ACTOR),
    ).rejects.toThrow();
  });

  it('requires dangerousCommands tier for dangerous cmds', async () => {
    await expect(
      registerCommand(TENANT, {
        name: 'drop-db', handler_key: 'admin.drop', is_dangerous: true,
      }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      registerCommand(TENANT, { name: 'ping', handler_key: 'core.ping' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listCommands', () => {
  it('lists active commands', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: CMD_ID, name: 'ping' }]);
    const rows = await listCommands(TENANT);
    expect(rows).toHaveLength(1);
  });
});

describe('executeCommand', () => {
  it('runs handler and records execution', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: CMD_ID, name: 'ping', handler_key: 'core.ping', is_dangerous: false }])
      .mockResolvedValueOnce([{ id: 'exec-1', status: 'completed' }]);

    const runner = vi.fn().mockResolvedValue({ pong: true });
    const result = await executeCommand(TENANT, { name: 'ping', args: {} }, ACTOR, runner);
    expect(runner).toHaveBeenCalledWith('core.ping', {}, { tenantId: TENANT, executedBy: ACTOR });
    expect(result.execution.status).toBe('completed');
    expect(result.result).toEqual({ pong: true });
  });

  it('throws NOT_FOUND for unknown command', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const runner = vi.fn();
    await expect(
      executeCommand(TENANT, { name: 'nope', args: {} }, ACTOR, runner),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records failure when runner throws', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: CMD_ID, name: 'boom', handler_key: 'core.boom', is_dangerous: false }])
      .mockResolvedValueOnce([{ id: 'exec-2', status: 'failed' }]);
    const runner = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      executeCommand(TENANT, { name: 'boom', args: {} }, ACTOR, runner),
    ).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('listExecutions', () => {
  it('returns history', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'exec-1' }]);
    const rows = await listExecutions(TENANT, 10);
    expect(rows).toHaveLength(1);
  });

  it('requires commandHistory tier', async () => {
    mockGetTierConfig.mockResolvedValue(defaultTier({ tiers: { commandHistory: false } }));
    await expect(listExecutions(TENANT)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
