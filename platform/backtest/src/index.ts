/**
 * platform/backtest
 *
 * Historical strategy simulation against market-data bars.
 * Simple rule form for MVP:
 *   { type: 'sma_cross', fast: 5, slow: 20, symbol }
 * Sandboxed cash/position — does not touch live portfolio tables.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getHistoricalBars, type Bar } from '@platform/market-data';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('backtest');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      backtestsPerDay: z.number().int().positive().default(20),
      maxLookbackYears: z.number().int().positive().default(5),
    })
    .default({}),
});

export type BacktestConfig = z.infer<typeof ConfigSchema>;

export type RuleSet =
  | { type: 'sma_cross'; symbol: string; fast: number; slow: number }
  | { type: 'buy_hold'; symbol: string };

export interface BacktestTrade {
  ts: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  cashAfter: number;
}

export interface BacktestResultSummary {
  startingCash: number;
  endingEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winRate: number;
  equityCurve: { ts: string; equity: number }[];
  trades: BacktestTrade[];
}

export interface BacktestRecord {
  id: string;
  tenantId: string;
  status: 'running' | 'completed' | 'failed';
  config: {
    ruleSet: RuleSet;
    symbols: string[];
    dateRange: { from: string; to: string };
    startingCash: number;
  };
  resultSummary: BacktestResultSummary | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const backtests = new Map<string, BacktestRecord>();
const dailyCounts = new Map<string, { day: string; count: number }>();

export function __resetBacktestStore(): void {
  backtests.clear();
  dailyCounts.clear();
}

async function loadCfg(): Promise<BacktestConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('backtest', ConfigSchema);
}

function sma(values: number[], period: number, idx: number): number | null {
  if (idx + 1 < period) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
  return sum / period;
}

function runSmaCross(bars: Bar[], rule: Extract<RuleSet, { type: 'sma_cross' }>, startingCash: number): BacktestResultSummary {
  const closes = bars.map((b) => b.close);
  let cash = startingCash;
  let qty = 0;
  let peak = startingCash;
  let maxDd = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { ts: string; equity: number }[] = [];
  let wins = 0;
  let closed = 0;
  let entryPrice = 0;

  for (let i = 0; i < bars.length; i++) {
    const fast = sma(closes, rule.fast, i);
    const slow = sma(closes, rule.slow, i);
    const price = closes[i];
    const equity = cash + qty * price;
    equityCurve.push({ ts: bars[i].ts, equity: Math.round(equity * 100) / 100 });
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;

    if (fast == null || slow == null) continue;

    const prevFast = i > 0 ? sma(closes, rule.fast, i - 1) : null;
    const prevSlow = i > 0 ? sma(closes, rule.slow, i - 1) : null;
    if (prevFast == null || prevSlow == null) continue;

    // Golden cross → buy
    if (prevFast <= prevSlow && fast > slow && qty === 0) {
      const buyQty = Math.floor(cash / price);
      if (buyQty > 0) {
        cash = Math.round((cash - buyQty * price) * 100) / 100;
        qty = buyQty;
        entryPrice = price;
        trades.push({
          ts: bars[i].ts,
          side: 'buy',
          price,
          qty: buyQty,
          cashAfter: cash,
        });
      }
    }

    // Death cross → sell
    if (prevFast >= prevSlow && fast < slow && qty > 0) {
      cash = Math.round((cash + qty * price) * 100) / 100;
      closed++;
      if (price > entryPrice) wins++;
      trades.push({
        ts: bars[i].ts,
        side: 'sell',
        price,
        qty,
        cashAfter: cash,
      });
      qty = 0;
    }
  }

  // Liquidate at end
  if (qty > 0 && bars.length) {
    const price = closes[closes.length - 1];
    cash = Math.round((cash + qty * price) * 100) / 100;
    closed++;
    if (price > entryPrice) wins++;
    trades.push({
      ts: bars[bars.length - 1].ts,
      side: 'sell',
      price,
      qty,
      cashAfter: cash,
    });
    qty = 0;
  }

  const endingEquity = cash;
  const totalReturnPct =
    startingCash > 0
      ? Math.round(((endingEquity - startingCash) / startingCash) * 10000) / 100
      : 0;

  return {
    startingCash,
    endingEquity,
    totalReturnPct,
    maxDrawdownPct: Math.round(maxDd * 100) / 100,
    tradeCount: trades.length,
    winRate: closed > 0 ? Math.round((wins / closed) * 10000) / 100 : 0,
    equityCurve,
    trades,
  };
}

function runBuyHold(bars: Bar[], startingCash: number): BacktestResultSummary {
  if (!bars.length) {
    return {
      startingCash,
      endingEquity: startingCash,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      tradeCount: 0,
      winRate: 0,
      equityCurve: [],
      trades: [],
    };
  }
  const entry = bars[0].close;
  const qty = Math.floor(startingCash / entry);
  const cashLeft = startingCash - qty * entry;
  const trades: BacktestTrade[] = [
    {
      ts: bars[0].ts,
      side: 'buy',
      price: entry,
      qty,
      cashAfter: cashLeft,
    },
  ];
  const equityCurve = bars.map((b) => ({
    ts: b.ts,
    equity: Math.round((cashLeft + qty * b.close) * 100) / 100,
  }));
  let peak = startingCash;
  let maxDd = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const endingEquity = equityCurve[equityCurve.length - 1].equity;
  return {
    startingCash,
    endingEquity,
    totalReturnPct:
      Math.round(((endingEquity - startingCash) / startingCash) * 10000) / 100,
    maxDrawdownPct: Math.round(maxDd * 100) / 100,
    tradeCount: 1,
    winRate: endingEquity >= startingCash ? 100 : 0,
    equityCurve,
    trades,
  };
}

export async function runBacktest(
  tenantId: string,
  actorId: string,
  input: {
    ruleSet: RuleSet;
    symbols?: string[];
    dateRange: { from: string; to: string };
    startingCash: number;
  },
): Promise<BacktestRecord> {
  return runCrudOperation({
    configName: 'backtest',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!(input.startingCash > 0)) {
        throw new AppError('startingCash must be positive', ErrorCode.BAD_REQUEST);
      }

      const from = new Date(input.dateRange.from);
      const to = new Date(input.dateRange.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        throw new AppError('Invalid dateRange', ErrorCode.BAD_REQUEST);
      }
      const years = (to.getTime() - from.getTime()) / (365.25 * 86_400_000);
      if (years > config.limits.maxLookbackYears) {
        throw new AppError(
          `Lookback exceeds maxLookbackYears (${config.limits.maxLookbackYears})`,
          ErrorCode.BAD_REQUEST,
        );
      }

      const day = new Date().toISOString().slice(0, 10);
      const dc = dailyCounts.get(tenantId);
      if (dc && dc.day === day && dc.count >= config.limits.backtestsPerDay) {
        throw new AppError(
          `Daily backtest limit reached (${config.limits.backtestsPerDay})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }
      dailyCounts.set(tenantId, {
        day,
        count: dc && dc.day === day ? dc.count + 1 : 1,
      });

      const id = crypto.randomUUID();
      const symbol =
        input.ruleSet.symbol ||
        (input.symbols && input.symbols[0]) ||
        '';
      if (!symbol) throw new AppError('symbol required on ruleSet', ErrorCode.BAD_REQUEST);

      const record: BacktestRecord = {
        id,
        tenantId,
        status: 'running',
        config: {
          ruleSet: input.ruleSet,
          symbols: input.symbols || [symbol],
          dateRange: input.dateRange,
          startingCash: input.startingCash,
        },
        resultSummary: null,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      backtests.set(id, record);

      try {
        const bars = await getHistoricalBars(tenantId, actorId, symbol, {
          from: input.dateRange.from,
          to: input.dateRange.to,
          granularity: '1d',
        });

        let summary: BacktestResultSummary;
        if (input.ruleSet.type === 'sma_cross') {
          summary = runSmaCross(bars, input.ruleSet, input.startingCash);
        } else {
          summary = runBuyHold(bars, input.startingCash);
        }

        record.status = 'completed';
        record.resultSummary = summary;
        record.completedAt = new Date().toISOString();
        backtests.set(id, record);
        logger.info(
          { backtestId: id, returnPct: summary.totalReturnPct },
          'Backtest completed',
        );
        return record;
      } catch (err: any) {
        record.status = 'failed';
        record.error = err?.message || String(err);
        record.completedAt = new Date().toISOString();
        backtests.set(id, record);
        throw err;
      }
    },
    auditAction: 'data.created',
    auditResource: 'backtest',
    meterEventType: 'api_call',
  });
}

export async function getBacktestResult(
  tenantId: string,
  backtestId: string,
): Promise<BacktestRecord | null> {
  const b = backtests.get(backtestId);
  if (!b || b.tenantId !== tenantId) return null;
  return b;
}
