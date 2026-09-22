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

import {
  registerPlugin,
  listPlugins,
  getPlugin,
  setPluginStatus,
  updatePluginConfig,
  registerHook,
  dispatchEvent,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const PLUGIN_ID = '33333333-3333-3333-3333-333333333333';

function defaultTier(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    tiers: {
      registerPlugins: true,
      enablePlugins: true,
      pluginConfig: true,
      hooks: true,
      ...(over.tiers as object),
    },
    limits: {
      maxPluginsPerTenant: 50,
      maxHooksPerPlugin: 20,
      ...(over.limits as object),
    },
  };
}

beforeEach(() => {
  mockWithTenantQuery.mockReset();
  mockGetTierConfig.mockReset();
  mockGetTierConfig.mockResolvedValue(defaultTier());
});

describe('registerPlugin', () => {
  it('registers a plugin', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: PLUGIN_ID, key: 'slack-notify' }]);
    const row = await registerPlugin(TENANT, {
      key: 'slack-notify', name: 'Slack Notify', version: '1.0.0',
    }, ACTOR);
    expect(row.key).toBe('slack-notify');
  });

  it('rejects invalid key', async () => {
    await expect(
      registerPlugin(TENANT, { key: 'Bad Key', name: 'X' }, ACTOR),
    ).rejects.toThrow();
  });

  it('throws FORBIDDEN when disabled', async () => {
    mockGetTierConfig.mockResolvedValue({ enabled: false, tiers: {}, limits: {} });
    await expect(
      registerPlugin(TENANT, { key: 'x', name: 'X' }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('getPlugin / setPluginStatus', () => {
  it('gets plugin', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: PLUGIN_ID, key: 'x' }]);
    const row = await getPlugin(TENANT, PLUGIN_ID);
    expect(row.id).toBe(PLUGIN_ID);
  });

  it('throws NOT_FOUND', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(getPlugin(TENANT, PLUGIN_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enables a plugin', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: PLUGIN_ID }])
      .mockResolvedValueOnce([{ id: PLUGIN_ID, status: 'enabled' }]);
    const row = await setPluginStatus(TENANT, PLUGIN_ID, 'enabled');
    expect(row.status).toBe('enabled');
  });
});

describe('updatePluginConfig', () => {
  it('updates config', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: PLUGIN_ID }])
      .mockResolvedValueOnce([{ id: PLUGIN_ID, config: { channel: '#ops' } }]);
    const row = await updatePluginConfig(TENANT, PLUGIN_ID, { channel: '#ops' });
    expect(row.config).toEqual({ channel: '#ops' });
  });
});

describe('registerHook + dispatchEvent', () => {
  it('registers a hook', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: PLUGIN_ID }])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ id: 'hook-1', event_name: 'order.created' }]);
    const row = await registerHook(TENANT, PLUGIN_ID, {
      event_name: 'order.created', handler_key: 'slack.onOrder', priority: 10,
    });
    expect(row.event_name).toBe('order.created');
  });

  it('dispatches to hooks in priority order', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([
      { handler_key: 'a', plugin_id: PLUGIN_ID, priority: 10 },
      { handler_key: 'b', plugin_id: PLUGIN_ID, priority: 20 },
    ]);
    const dispatcher = vi.fn().mockResolvedValue({ ok: true });
    const results = await dispatchEvent(TENANT, 'order.created', { id: 1 }, dispatcher);
    expect(dispatcher).toHaveBeenCalledTimes(2);
    expect(dispatcher.mock.calls[0][0]).toBe('a');
    expect(dispatcher.mock.calls[1][0]).toBe('b');
    expect(results).toHaveLength(2);
  });
});

describe('listPlugins', () => {
  it('lists plugins', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: PLUGIN_ID }]);
    const rows = await listPlugins(TENANT);
    expect(rows).toHaveLength(1);
  });
});
