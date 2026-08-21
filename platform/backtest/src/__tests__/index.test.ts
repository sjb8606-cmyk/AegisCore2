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
      limits: { backtestsPerDay: 10, maxLookbackYears: 5 },
    }),
  };
});

vi.mock('@platform/market-data', () => ({
  getHistoricalBars: vi.fn().mockImplementation(async () => {
    // 40 synthetic daily bars with a trend
    const bars = [];
    let px = 100;
    for (let i = 0; i < 40; i++) {
      px = px + (i % 7 === 0 ? 2 : i % 5 === 0 ? -1.5 : 0.3);
      bars.push({
        symbol: 'AAPL',
        ts: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
        open: px,
        high: px * 1.01,
        low: px * 0.99,
        close: px,
        volume: 1e6,
        granularity: '1d',
      });
    }
    return bars;
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
  runBacktest,
  getBacktestResult,
  __resetBacktestStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('backtest', () => {
  beforeEach(() => {
    __resetBacktestStore();
    vi.clearAllMocks();
  });

  it('runs buy_hold and returns equity curve', async () => {
    const rec = await runBacktest(tenantId, actorId, {
      ruleSet: { type: 'buy_hold', symbol: 'AAPL' },
      dateRange: { from: '2024-01-01', to: '2024-02-10' },
      startingCash: 10_000,
    });
    expect(rec.status).toBe('completed');
    expect(rec.resultSummary?.equityCurve.length).toBeGreaterThan(0);
    expect(rec.resultSummary?.tradeCount).toBe(1);
  });

  it('runs sma_cross strategy', async () => {
    const rec = await runBacktest(tenantId, actorId, {
      ruleSet: { type: 'sma_cross', symbol: 'AAPL', fast: 3, slow: 7 },
      dateRange: { from: '2024-01-01', to: '2024-02-10' },
      startingCash: 10_000,
    });
    expect(rec.status).toBe('completed');
    expect(rec.resultSummary).toBeTruthy();
    expect(typeof rec.resultSummary!.totalReturnPct).toBe('number');
  });

  it('getBacktestResult returns stored record', async () => {
    const rec = await runBacktest(tenantId, actorId, {
      ruleSet: { type: 'buy_hold', symbol: 'AAPL' },
      dateRange: { from: '2024-01-01', to: '2024-02-10' },
      startingCash: 5_000,
    });
    const got = await getBacktestResult(tenantId, rec.id);
    expect(got?.id).toBe(rec.id);
  });

  it('rejects overlong lookback', async () => {
    try {
      await runBacktest(tenantId, actorId, {
        ruleSet: { type: 'buy_hold', symbol: 'AAPL' },
        dateRange: { from: '2010-01-01', to: '2024-01-01' },
        startingCash: 10_000,
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/lookback|maxLookback/i);
    }
  });
});
