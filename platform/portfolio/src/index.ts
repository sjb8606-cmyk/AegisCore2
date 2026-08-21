/**
 * platform/portfolio
 *
 * Mark-to-market position + P&L tracking (not double-entry fintech).
 * paper | live mode. Values open positions via market-data quotes.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getQuote } from '@platform/market-data';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('portfolio');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['paper', 'live']).default('paper'),
  limits: z
    .object({
      positionsPerPortfolio: z.number().int().positive().default(50),
      portfoliosPerTenant: z.number().int().positive().default(5),
    })
    .default({}),
  tiers: z
    .object({
      realtimePnl: z.boolean().default(true),
      multiPortfolio: z.boolean().default(true),
      riskMetrics: z.boolean().default(false),
    })
    .default({}),
});

export type PortfolioConfig = z.infer<typeof ConfigSchema>;

export interface Portfolio {
  id: string;
  tenantId: string;
  name: string;
  mode: 'paper' | 'live';
  startingCash: number;
  currentCash: number;
  createdAt: string;
}

export interface Position {
  id: string;
  portfolioId: string;
  tenantId: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  status: 'open' | 'closed';
}

export interface PortfolioSnapshot {
  portfolio: Portfolio;
  positions: Position[];
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  equity: number;
  exposurePct: number;
}

// ── Memory store (unit tests / paper without DB) ─────────────

const portfolios = new Map<string, Portfolio>();
const positions = new Map<string, Position>();
const tenantIndex = new Map<string, Set<string>>(); // tenant → portfolio ids

export function __resetPortfolioStore(): void {
  portfolios.clear();
  positions.clear();
  tenantIndex.clear();
}

async function loadCfg(): Promise<PortfolioConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('portfolio', ConfigSchema);
}

function assertPortfolio(tenantId: string, portfolioId: string): Portfolio {
  const p = portfolios.get(portfolioId);
  if (!p || p.tenantId !== tenantId) {
    throw new AppError('Portfolio not found', ErrorCode.NOT_FOUND);
  }
  return p;
}

// ── API ──────────────────────────────────────────────────────

export async function createPortfolio(
  tenantId: string,
  actorId: string,
  input: { name: string; mode?: 'paper' | 'live'; startingCash: number },
): Promise<Portfolio> {
  return runCrudOperation({
    configName: 'portfolio',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      if (!(input.startingCash > 0)) {
        throw new AppError('startingCash must be positive', ErrorCode.BAD_REQUEST);
      }

      const existing = tenantIndex.get(tenantId)?.size ?? 0;
      if (existing >= config.limits.portfoliosPerTenant) {
        throw new AppError(
          `Portfolio limit reached (${config.limits.portfoliosPerTenant})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }
      if (!config.tiers.multiPortfolio && existing >= 1) {
        throw new AppError('multiPortfolio tier disabled', ErrorCode.FORBIDDEN);
      }

      const mode = input.mode || config.mode;
      const id = crypto.randomUUID();
      const portfolio: Portfolio = {
        id,
        tenantId,
        name: input.name.trim(),
        mode,
        startingCash: input.startingCash,
        currentCash: input.startingCash,
        createdAt: new Date().toISOString(),
      };
      portfolios.set(id, portfolio);
      if (!tenantIndex.has(tenantId)) tenantIndex.set(tenantId, new Set());
      tenantIndex.get(tenantId)!.add(id);

      logger.info({ portfolioId: id, mode }, 'Portfolio created');
      return portfolio;
    },
    auditAction: 'data.created',
    auditResource: 'portfolio',
    meterEventType: 'api_call',
  });
}

export async function openPosition(
  tenantId: string,
  actorId: string,
  portfolioId: string,
  input: { symbol: string; qty: number; entryPrice: number; side?: 'long' | 'short' },
): Promise<Position> {
  return runCrudOperation({
    configName: 'portfolio',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const portfolio = assertPortfolio(tenantId, portfolioId);

      const symbol = (input.symbol || '').toUpperCase();
      if (!symbol) throw new AppError('symbol is required', ErrorCode.BAD_REQUEST);
      if (!(input.qty > 0)) throw new AppError('qty must be positive', ErrorCode.BAD_REQUEST);
      if (!(input.entryPrice > 0)) {
        throw new AppError('entryPrice must be positive', ErrorCode.BAD_REQUEST);
      }

      const openCount = [...positions.values()].filter(
        (p) => p.portfolioId === portfolioId && p.status === 'open',
      ).length;
      if (openCount >= config.limits.positionsPerPortfolio) {
        throw new AppError(
          `Position limit reached (${config.limits.positionsPerPortfolio})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }

      const side = input.side || 'long';
      const cost = input.qty * input.entryPrice;
      if (side === 'long' && portfolio.currentCash < cost) {
        throw new AppError('Insufficient cash', ErrorCode.FORBIDDEN);
      }

      if (side === 'long') {
        portfolio.currentCash = Math.round((portfolio.currentCash - cost) * 100) / 100;
      }

      const pos: Position = {
        id: crypto.randomUUID(),
        portfolioId,
        tenantId,
        symbol,
        side,
        qty: input.qty,
        entryPrice: input.entryPrice,
        exitPrice: null,
        openedAt: new Date().toISOString(),
        closedAt: null,
        status: 'open',
      };
      positions.set(pos.id, pos);
      portfolios.set(portfolioId, portfolio);

      logger.info({ positionId: pos.id, symbol, qty: pos.qty }, 'Position opened');
      return pos;
    },
    auditAction: 'data.created',
    auditResource: 'position',
    meterEventType: 'api_call',
  });
}

export async function closePosition(
  tenantId: string,
  actorId: string,
  positionId: string,
  exitPrice: number,
): Promise<Position> {
  return runCrudOperation({
    configName: 'portfolio',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!(exitPrice > 0)) {
        throw new AppError('exitPrice must be positive', ErrorCode.BAD_REQUEST);
      }
      const pos = positions.get(positionId);
      if (!pos || pos.tenantId !== tenantId) {
        throw new AppError('Position not found', ErrorCode.NOT_FOUND);
      }
      if (pos.status !== 'open') {
        throw new AppError('Position already closed', ErrorCode.CONFLICT);
      }

      const portfolio = assertPortfolio(tenantId, pos.portfolioId);
      const proceeds = pos.qty * exitPrice;

      if (pos.side === 'long') {
        portfolio.currentCash = Math.round((portfolio.currentCash + proceeds) * 100) / 100;
      }

      pos.exitPrice = exitPrice;
      pos.closedAt = new Date().toISOString();
      pos.status = 'closed';
      positions.set(positionId, pos);
      portfolios.set(portfolio.id, portfolio);

      logger.info({ positionId, exitPrice }, 'Position closed');
      return pos;
    },
    auditAction: 'data.updated',
    auditResource: 'position',
    meterEventType: 'api_call',
  });
}

export async function getPortfolioSnapshot(
  tenantId: string,
  actorId: string,
  portfolioId: string,
): Promise<PortfolioSnapshot> {
  return runCrudOperation({
    configName: 'portfolio',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const portfolio = assertPortfolio(tenantId, portfolioId);
      const all = [...positions.values()].filter((p) => p.portfolioId === portfolioId);
      const open = all.filter((p) => p.status === 'open');

      let marketValue = 0;
      let unrealizedPnl = 0;

      for (const pos of open) {
        let mark = pos.entryPrice;
        try {
          const q = await getQuote(tenantId, actorId, pos.symbol);
          mark = q.price;
        } catch {
          // keep entry as mark if quote fails
        }
        const mv = pos.qty * mark;
        marketValue += mv;
        if (pos.side === 'long') {
          unrealizedPnl += (mark - pos.entryPrice) * pos.qty;
        } else {
          unrealizedPnl += (pos.entryPrice - mark) * pos.qty;
        }
      }

      let realizedPnl = 0;
      for (const pos of all.filter((p) => p.status === 'closed' && p.exitPrice != null)) {
        if (pos.side === 'long') {
          realizedPnl += (pos.exitPrice! - pos.entryPrice) * pos.qty;
        } else {
          realizedPnl += (pos.entryPrice - pos.exitPrice!) * pos.qty;
        }
      }

      const equity = portfolio.currentCash + marketValue;
      const exposurePct =
        equity > 0 ? Math.round((marketValue / equity) * 10000) / 100 : 0;

      return {
        portfolio,
        positions: all,
        marketValue: Math.round(marketValue * 100) / 100,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        realizedPnl: Math.round(realizedPnl * 100) / 100,
        equity: Math.round(equity * 100) / 100,
        exposurePct,
      };
    },
    auditAction: 'data.read',
    auditResource: 'portfolio',
    meterEventType: 'api_call',
  });
}

export async function listPortfolios(tenantId: string): Promise<Portfolio[]> {
  const ids = tenantIndex.get(tenantId);
  if (!ids) return [];
  return [...ids].map((id) => portfolios.get(id)!).filter(Boolean);
}
