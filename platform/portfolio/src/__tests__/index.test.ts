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
      limits: { positionsPerPortfolio: 10, portfoliosPerTenant: 3 },
      tiers: { realtimePnl: true, multiPortfolio: true, riskMetrics: false },
    }),
  };
});

vi.mock('@platform/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'AAPL',
    price: 110,
    bid: 109.9,
    ask: 110.1,
    volume: 1e6,
    ts: new Date().toISOString(),
    provider: 'mock',
  }),
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
  createPortfolio,
  openPosition,
  closePosition,
  getPortfolioSnapshot,
  __resetPortfolioStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('portfolio', () => {
  beforeEach(() => {
    __resetPortfolioStore();
    vi.clearAllMocks();
  });

  it('creates a paper portfolio with starting cash', async () => {
    const p = await createPortfolio(tenantId, actorId, {
      name: 'Algo Test',
      startingCash: 10_000,
    });
    expect(p.currentCash).toBe(10_000);
    expect(p.mode).toBe('paper');
  });

  it('opens a long position and reduces cash', async () => {
    const p = await createPortfolio(tenantId, actorId, {
      name: 'P',
      startingCash: 10_000,
    });
    const pos = await openPosition(tenantId, actorId, p.id, {
      symbol: 'AAPL',
      qty: 10,
      entryPrice: 100,
    });
    expect(pos.status).toBe('open');
    const snap = await getPortfolioSnapshot(tenantId, actorId, p.id);
    expect(snap.portfolio.currentCash).toBe(9000);
    expect(snap.positions).toHaveLength(1);
  });

  it('marks unrealized pnl from market-data quote', async () => {
    const p = await createPortfolio(tenantId, actorId, {
      name: 'P',
      startingCash: 10_000,
    });
    await openPosition(tenantId, actorId, p.id, {
      symbol: 'AAPL',
      qty: 10,
      entryPrice: 100,
    });
    const snap = await getPortfolioSnapshot(tenantId, actorId, p.id);
    // mark 110 → +10 * 10 = +100 unrealized
    expect(snap.unrealizedPnl).toBe(100);
    expect(snap.equity).toBe(10_100);
  });

  it('closes position and realizes pnl', async () => {
    const p = await createPortfolio(tenantId, actorId, {
      name: 'P',
      startingCash: 10_000,
    });
    const pos = await openPosition(tenantId, actorId, p.id, {
      symbol: 'AAPL',
      qty: 10,
      entryPrice: 100,
    });
    await closePosition(tenantId, actorId, pos.id, 120);
    const snap = await getPortfolioSnapshot(tenantId, actorId, p.id);
    expect(snap.realizedPnl).toBe(200);
    expect(snap.portfolio.currentCash).toBe(10_200);
  });

  it('rejects insufficient cash', async () => {
    const p = await createPortfolio(tenantId, actorId, {
      name: 'P',
      startingCash: 100,
    });
    try {
      await openPosition(tenantId, actorId, p.id, {
        symbol: 'AAPL',
        qty: 10,
        entryPrice: 100,
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/insufficient/i);
    }
  });
});
