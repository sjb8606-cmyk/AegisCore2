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
      providers: { realtime: 'mock', historical: 'mock' },
      limits: { symbolsTracked: 3, historyLookbackDays: 30, pollIntervalSec: 60 },
      tiers: { realtimeStreaming: false, level2Data: false, optionsChain: false },
    }),
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
  subscribeSymbol,
  unsubscribeSymbol,
  getWatchlist,
  getQuote,
  getHistoricalBars,
  __resetMarketDataStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('market-data', () => {
  beforeEach(() => {
    __resetMarketDataStore();
    vi.clearAllMocks();
  });

  it('subscribes and lists watchlist', async () => {
    await subscribeSymbol(tenantId, actorId, 'aapl');
    await subscribeSymbol(tenantId, actorId, 'MSFT');
    const list = await getWatchlist(tenantId);
    expect(list).toEqual(['AAPL', 'MSFT']);
  });

  it('enforces symbolsTracked limit', async () => {
    await subscribeSymbol(tenantId, actorId, 'AAPL');
    await subscribeSymbol(tenantId, actorId, 'MSFT');
    await subscribeSymbol(tenantId, actorId, 'GOOG');
    try {
      await subscribeSymbol(tenantId, actorId, 'TSLA');
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/limit/i);
    }
  });

  it('returns a quote with bid/ask/price', async () => {
    const q = await getQuote(tenantId, actorId, 'AAPL');
    expect(q.symbol).toBe('AAPL');
    expect(q.price).toBeGreaterThan(0);
    expect(q.ask).toBeGreaterThanOrEqual(q.bid);
  });

  it('returns historical daily bars', async () => {
    const bars = await getHistoricalBars(tenantId, actorId, 'AAPL', {
      from: '2024-01-01',
      to: '2024-01-10',
      granularity: '1d',
    });
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0].open).toBeGreaterThan(0);
    expect(bars[0].granularity).toBe('1d');
  });

  it('rejects invalid symbols', async () => {
    try {
      await getQuote(tenantId, actorId, '!!!');
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/invalid/i);
    }
  });

  it('unsubscribe removes symbol', async () => {
    await subscribeSymbol(tenantId, actorId, 'AAPL');
    await unsubscribeSymbol(tenantId, actorId, 'AAPL');
    expect(await getWatchlist(tenantId)).toEqual([]);
  });
});
