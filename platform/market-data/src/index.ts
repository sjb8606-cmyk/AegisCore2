/**
 * platform/market-data
 *
 * Single source of truth for quotes + historical bars.
 * Other trading cores read here — they never hit external APIs directly.
 *
 * Default provider: mock (deterministic, offline-friendly).
 * Real providers (polygon/alpaca/finnhub) plug in behind the same interface.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('market-data');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z
    .object({
      realtime: z.enum(['mock', 'polygon', 'alpaca', 'finnhub']).default('mock'),
      historical: z.enum(['mock', 'polygon', 'alpha_vantage']).default('mock'),
    })
    .default({}),
  limits: z
    .object({
      symbolsTracked: z.number().int().positive().default(25),
      historyLookbackDays: z.number().int().positive().default(365),
      pollIntervalSec: z.number().int().positive().default(60),
    })
    .default({}),
  tiers: z
    .object({
      realtimeStreaming: z.boolean().default(false),
      level2Data: z.boolean().default(false),
      optionsChain: z.boolean().default(false),
    })
    .default({}),
});

export type MarketDataConfig = z.infer<typeof ConfigSchema>;

export interface Quote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  ts: string;
  provider: string;
}

export interface Bar {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  granularity: string;
}

export type Granularity = '1m' | '5m' | '15m' | '1h' | '1d';

// ── In-memory stores (tests + mock provider) ─────────────────

const watchlists = new Map<string, Set<string>>(); // tenantId → symbols
const quoteCache = new Map<string, Quote>(); // symbol → quote
const barStore = new Map<string, Bar[]>(); // `\( {symbol}: \){granularity}` → bars

export function __resetMarketDataStore(): void {
  watchlists.clear();
  quoteCache.clear();
  barStore.clear();
}

// ── Mock price engine (deterministic from symbol hash) ───────

function mockBasePrice(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
  const n = Math.abs(h % 90000) / 100 + 10; // $10–$910
  return Math.round(n * 100) / 100;
}

function mockQuote(symbol: string, provider: string): Quote {
  const base = mockBasePrice(symbol);
  const jitter = ((Date.now() / 1000) % 7) * 0.01 * base;
  const price = Math.round((base + jitter) * 100) / 100;
  const spread = Math.max(0.01, price * 0.0005);
  return {
    symbol: symbol.toUpperCase(),
    price,
    bid: Math.round((price - spread / 2) * 100) / 100,
    ask: Math.round((price + spread / 2) * 100) / 100,
    volume: 1_000_000 + Math.abs(symbol.length * 12345),
    ts: new Date().toISOString(),
    provider,
  };
}

function mockBars(
  symbol: string,
  from: Date,
  to: Date,
  granularity: Granularity,
): Bar[] {
  const bars: Bar[] = [];
  const stepMs =
    granularity === '1m'
      ? 60_000
      : granularity === '5m'
        ? 300_000
        : granularity === '15m'
          ? 900_000
          : granularity === '1h'
            ? 3_600_000
            : 86_400_000;

  let t = from.getTime();
  let px = mockBasePrice(symbol);
  const end = to.getTime();
  let guard = 0;

  while (t <= end && guard < 50_000) {
    const open = px;
    const delta = (Math.sin(t / 1e8) + Math.cos(symbol.length + guard)) * px * 0.01;
    const close = Math.round((open + delta) * 100) / 100;
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    bars.push({
      symbol: symbol.toUpperCase(),
      ts: new Date(t).toISOString(),
      open,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close,
      volume: 100_000 + (guard % 50_000),
      granularity,
    });
    px = close;
    t += stepMs;
    guard++;
  }
  return bars;
}

function normalizeSymbol(symbol: string): string {
  const s = (symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(s)) {
    throw new AppError('Invalid symbol', ErrorCode.BAD_REQUEST);
  }
  return s;
}

async function loadCfg(): Promise<MarketDataConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('market-data', ConfigSchema);
}

// ── Public API ───────────────────────────────────────────────

export async function subscribeSymbol(
  tenantId: string,
  actorId: string,
  symbol: string,
): Promise<{ symbol: string; tracked: number }> {
  const sym = normalizeSymbol(symbol);

  return runCrudOperation({
    configName: 'market-data',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      let set = watchlists.get(tenantId);
      if (!set) {
        set = new Set();
        watchlists.set(tenantId, set);
      }
      if (!set.has(sym) && set.size >= config.limits.symbolsTracked) {
        throw new AppError(
          `Watchlist limit reached (${config.limits.symbolsTracked})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }
      set.add(sym);
      // Warm quote cache
      const q = mockQuote(sym, config.providers.realtime);
      quoteCache.set(sym, q);
      logger.info({ tenantId, symbol: sym }, 'Symbol subscribed');
      return { symbol: sym, tracked: set.size };
    },
    auditAction: 'data.created',
    auditResource: 'watchlist_symbol',
    meterEventType: 'api_call',
  });
}

export async function unsubscribeSymbol(
  tenantId: string,
  actorId: string,
  symbol: string,
): Promise<{ symbol: string; tracked: number }> {
  const sym = normalizeSymbol(symbol);

  return runCrudOperation({
    configName: 'market-data',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const set = watchlists.get(tenantId) || new Set();
      set.delete(sym);
      watchlists.set(tenantId, set);
      return { symbol: sym, tracked: set.size };
    },
    auditAction: 'data.deleted',
    auditResource: 'watchlist_symbol',
    meterEventType: 'api_call',
  });
}

export async function getWatchlist(tenantId: string): Promise<string[]> {
  const set = watchlists.get(tenantId);
  return set ? Array.from(set).sort() : [];
}

export async function getQuote(
  tenantId: string,
  actorId: string,
  symbol: string,
): Promise<Quote> {
  const sym = normalizeSymbol(symbol);

  return runCrudOperation({
    configName: 'market-data',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      // Refresh mock quote each call (simulates live)
      const q = mockQuote(sym, config.providers.realtime);
      quoteCache.set(sym, q);
      return q;
    },
    auditAction: 'data.read',
    auditResource: 'price_quote',
    meterEventType: 'api_call',
  });
}

export async function getHistoricalBars(
  tenantId: string,
  actorId: string,
  symbol: string,
  opts: { from: string; to: string; granularity?: Granularity },
): Promise<Bar[]> {
  const sym = normalizeSymbol(symbol);
  const granularity: Granularity = opts.granularity || '1d';

  return runCrudOperation({
    configName: 'market-data',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const from = new Date(opts.from);
      const to = new Date(opts.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new AppError('Invalid from/to range', ErrorCode.BAD_REQUEST);
      }
      const maxMs = config.limits.historyLookbackDays * 86_400_000;
      if (to.getTime() - from.getTime() > maxMs) {
        throw new AppError(
          `Lookback exceeds limit (${config.limits.historyLookbackDays} days)`,
          ErrorCode.BAD_REQUEST,
        );
      }

      const key = `\( {sym}: \){granularity}`;
      let bars = mockBars(sym, from, to, granularity);
      barStore.set(key, bars);
      logger.debug({ symbol: sym, bars: bars.length, granularity }, 'Historical bars');
      return bars;
    },
    auditAction: 'data.read',
    auditResource: 'price_bars',
    meterEventType: 'api_call',
  });
}

/**
 * Seed helper for backtests — inject deterministic bars without provider calls.
 */
export function __seedBars(symbol: string, bars: Bar[]): void {
  const sym = normalizeSymbol(symbol);
  if (!bars.length) return;
  const granularity = bars[0].granularity;
  barStore.set(`\( {sym}: \){granularity}`, bars);
}
