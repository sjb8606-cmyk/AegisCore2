import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({ enabled: true }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  listTools,
  executeTool,
  enforcePermissionBoundary,
  getToolContract,
  __resetToolRegistryStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('tool-registry', () => {
  beforeEach(() => {
    __resetToolRegistryStore();
    vi.clearAllMocks();
  });

  it('lists builtin tools', () => {
    const tools = listTools();
    expect(tools.some((t) => t.name === 'web_search')).toBe(true);
    expect(tools.some((t) => t.name === 'place_order')).toBe(true);
  });

  it('executes allowed tool', async () => {
    const { result } = await executeTool(tenantId, actorId, {
      name: 'web_search',
      args: { query: 'aegiscore' },
      allowedTools: ['web_search', 'noop'],
    });
    expect((result as any).results).toBeTruthy();
  });

  it('blocks tool not in allowedTools', async () => {
    try {
      await executeTool(tenantId, actorId, {
        name: 'send_email',
        args: { to: 'a@b.com', subject: 'x', body: 'y' },
        allowedTools: ['noop'],
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/allowedTools|forbidden/i);
    }
  });

  it('place_order is high risk irreversible', () => {
    const c = getToolContract('place_order');
    expect(c?.riskLevel).toBe(5);
    expect(c?.reversible).toBe(false);
    expect(c?.requiresConfirmation).toBe(true);
  });

  it('enforcePermissionBoundary throws', () => {
    expect(() => enforcePermissionBoundary('send_email', ['noop'])).toThrow();
  });
});
