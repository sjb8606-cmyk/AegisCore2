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
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      mode: 'paper',
      broker: null,
      autonomy: {
        defaultMode: 'human_approval_required',
        perPortfolioOverride: true,
        autoExecuteCapPerTradeUsd: 500,
        autoExecuteDailyCapUsd: 2000,
      },
      limits: { ordersPerDay: 50 },
    }),
  };
});

vi.mock('@platform/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'AAPL',
    price: 100,
    bid: 99.9,
    ask: 100.1,
    volume: 1e6,
    ts: new Date().toISOString(),
    provider: 'mock',
  }),
}));

vi.mock('@platform/portfolio', () => ({
  openPosition: vi.fn().mockResolvedValue({ id: 'pos-1', status: 'open' }),
  closePosition: vi.fn().mockResolvedValue({ id: 'pos-1', status: 'closed' }),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  submitOrder,
  approveOrder,
  rejectOrder,
  requiresApproval,
  __resetTradeExecutionStore,
} from '../index';
import { openPosition } from '@platform/portfolio';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const portfolioId = '00000000-0000-4000-8000-0000000000p1';

describe('trade-execution', () => {
  beforeEach(() => {
    __resetTradeExecutionStore();
    vi.clearAllMocks();
  });

  it('requiresApproval is true under human_approval_required', () => {
    const config: any = {
      autonomy: {
        defaultMode: 'human_approval_required',
        autoExecuteCapPerTradeUsd: 500,
      },
    };
    expect(requiresApproval({ notionalUsd: 50, source: 'agent' }, config)).toBe(
      true,
    );
  });

  it('requiresApproval is false in auto_execute under cap', () => {
    const config: any = {
      autonomy: {
        defaultMode: 'auto_execute',
        autoExecuteCapPerTradeUsd: 500,
      },
    };
    expect(requiresApproval({ notionalUsd: 100, source: 'agent' }, config)).toBe(
      false,
    );
    expect(requiresApproval({ notionalUsd: 600, source: 'agent' }, config)).toBe(
      true,
    );
  });

  it('submitOrder defaults to pending_approval', async () => {
    const order = await submitOrder(tenantId, actorId, {
      portfolioId,
      symbol: 'AAPL',
      side: 'buy',
      qty: 5,
      source: 'agent',
    });
    expect(order.status).toBe('pending_approval');
    expect(order.requiresApproval).toBe(true);
    expect(order.chainHash).toMatch(/^[0-9a-f]{64}$/);
    expect(openPosition).not.toHaveBeenCalled();
  });

  it('approveOrder fills in paper mode', async () => {
    const order = await submitOrder(tenantId, actorId, {
      portfolioId,
      symbol: 'AAPL',
      side: 'buy',
      qty: 5,
    });
    const filled = await approveOrder(tenantId, actorId, order.id);
    expect(filled.status).toBe('filled');
    expect(filled.fillPrice).toBe(100);
    expect(openPosition).toHaveBeenCalled();
  });

  it('rejectOrder blocks execution', async () => {
    const order = await submitOrder(tenantId, actorId, {
      portfolioId,
      symbol: 'AAPL',
      side: 'buy',
      qty: 5,
    });
    const rejected = await rejectOrder(tenantId, actorId, order.id, 'nope');
    expect(rejected.status).toBe('rejected');
    expect(openPosition).not.toHaveBeenCalled();
  });
});
