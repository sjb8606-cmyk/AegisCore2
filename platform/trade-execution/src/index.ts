/**
 * platform/trade-execution
 *
 * Order placement with HITL gate.
 * Every order — manual, rule, or agent — passes through here.
 *
 * Defaults to human_approval_required.
 * auto_execute only within hard USD caps.
 * Paper mode fills via portfolio; live broker is a future port.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getQuote } from '@platform/market-data';
import { openPosition, closePosition } from '@platform/portfolio';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('trade-execution');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['paper', 'live']).default('paper'),
  broker: z.enum(['alpaca', 'ibkr']).nullable().default(null),
  autonomy: z
    .object({
      defaultMode: z
        .enum(['human_approval_required', 'auto_execute'])
        .default('human_approval_required'),
      perPortfolioOverride: z.boolean().default(true),
      autoExecuteCapPerTradeUsd: z.number().positive().default(500),
      autoExecuteDailyCapUsd: z.number().positive().default(2000),
    })
    .default({}),
  limits: z
    .object({
      ordersPerDay: z.number().int().positive().default(50),
    })
    .default({}),
});

export type TradeExecutionConfig = z.infer<typeof ConfigSchema>;

export type OrderSource = 'manual' | 'rule' | 'agent';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'filled'
  | 'cancelled';

export interface Order {
  id: string;
  tenantId: string;
  portfolioId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  orderType: OrderType;
  limitPrice: number | null;
  source: OrderSource;
  status: OrderStatus;
  requiresApproval: boolean;
  approvedBy: string | null;
  rejectedBy: string | null;
  submittedAt: string;
  filledAt: string | null;
  fillPrice: number | null;
  notionalUsd: number;
  reason: string | null;
  chainHash: string;
  previousHash: string;
}

// ── Memory ───────────────────────────────────────────────────

const orders = new Map<string, Order>();
const dailyNotional = new Map<string, { day: string; usd: number }>(); // tenant → spend
const chainTips = new Map<string, string>(); // tenant → last order chain hash

export function __resetTradeExecutionStore(): void {
  orders.clear();
  dailyNotional.clear();
  chainTips.clear();
}

async function loadCfg(): Promise<TradeExecutionConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('trade-execution', ConfigSchema);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailySpent(tenantId: string): number {
  const row = dailyNotional.get(tenantId);
  if (!row || row.day !== todayKey()) return 0;
  return row.usd;
}

function addDailySpent(tenantId: string, usd: number): void {
  const day = todayKey();
  const row = dailyNotional.get(tenantId);
  if (!row || row.day !== day) {
    dailyNotional.set(tenantId, { day, usd });
  } else {
    row.usd = Math.round((row.usd + usd) * 100) / 100;
  }
}

/**
 * Gate: does this order require human approval?
 */
export function requiresApproval(
  order: { notionalUsd: number; source: OrderSource },
  config: TradeExecutionConfig,
): boolean {
  if (config.autonomy.defaultMode === 'human_approval_required') {
    return true;
  }
  // auto_execute mode — still gated by caps
  if (order.notionalUsd > config.autonomy.autoExecuteCapPerTradeUsd) {
    return true;
  }
  return false;
}

async function paperFill(
  tenantId: string,
  actorId: string,
  order: Order,
  fillPrice: number,
): Promise<void> {
  if (order.side === 'buy') {
    await openPosition(tenantId, actorId, order.portfolioId, {
      symbol: order.symbol,
      qty: order.qty,
      entryPrice: fillPrice,
      side: 'long',
    });
  } else {
    // Simplified: close by opening inverse is not modeled;
    // sell expects caller to pass a position close via portfolio in a later revision.
    // For paper buys we fully support; sells mark fill without position link for now.
    logger.warn({ orderId: order.id }, 'Paper sell fill recorded without position link');
  }
}

function appendOrderChain(
  tenantId: string,
  payload: Record<string, unknown>,
): { previousHash: string; chainHash: string } {
  const previousHash = chainTips.get(tenantId) || GENESIS_HASH;
  const chainHash = computeChainHash(tenantId, 'order', payload, previousHash);
  chainTips.set(tenantId, chainHash);
  return { previousHash, chainHash };
}

// ── API ──────────────────────────────────────────────────────

export async function submitOrder(
  tenantId: string,
  actorId: string,
  input: {
    portfolioId: string;
    symbol: string;
    side: OrderSide;
    qty: number;
    orderType?: OrderType;
    limitPrice?: number;
    source?: OrderSource;
    reason?: string;
  },
): Promise<Order> {
  return runCrudOperation({
    configName: 'trade-execution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const symbol = (input.symbol || '').toUpperCase();
      if (!symbol) throw new AppError('symbol is required', ErrorCode.BAD_REQUEST);
      if (!(input.qty > 0)) throw new AppError('qty must be positive', ErrorCode.BAD_REQUEST);
      if (!input.portfolioId) {
        throw new AppError('portfolioId is required', ErrorCode.BAD_REQUEST);
      }

      // Estimate notional from live quote (or limit)
      let refPrice = input.limitPrice || 0;
      if (!refPrice || input.orderType === 'market') {
        const q = await getQuote(tenantId, actorId, symbol);
        refPrice = q.price;
      }
      const notionalUsd = Math.round(input.qty * refPrice * 100) / 100;

      // Daily order count
      const today = todayKey();
      const todays = [...orders.values()].filter(
        (o) => o.tenantId === tenantId && o.submittedAt.startsWith(today),
      );
      if (todays.length >= config.limits.ordersPerDay) {
        throw new AppError(
          `Daily order limit reached (${config.limits.ordersPerDay})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }

      // Daily auto-spend cap (applies when auto path would run)
      const spent = getDailySpent(tenantId);
      const source: OrderSource = input.source || 'manual';
      const needsApproval = requiresApproval({ notionalUsd, source }, config);

      // Even in auto mode, daily cap forces approval
      let requires = needsApproval;
      if (
        !requires &&
        spent + notionalUsd > config.autonomy.autoExecuteDailyCapUsd
      ) {
        requires = true;
      }

      const id = crypto.randomUUID();
      const submittedAt = new Date().toISOString();
      const chainPayload = {
        id,
        portfolioId: input.portfolioId,
        symbol,
        side: input.side,
        qty: input.qty,
        notionalUsd,
        source,
        requiresApproval: requires,
        actorId,
        submittedAt,
      };
      const { previousHash, chainHash } = appendOrderChain(tenantId, chainPayload);

      const order: Order = {
        id,
        tenantId,
        portfolioId: input.portfolioId,
        symbol,
        side: input.side,
        qty: input.qty,
        orderType: input.orderType || 'market',
        limitPrice: input.limitPrice ?? null,
        source,
        status: requires ? 'pending_approval' : 'approved',
        requiresApproval: requires,
        approvedBy: requires ? null : 'system:auto',
        rejectedBy: null,
        submittedAt,
        filledAt: null,
        fillPrice: null,
        notionalUsd,
        reason: input.reason ?? null,
        chainHash,
        previousHash,
      };
      orders.set(id, order);

      logger.info(
        { orderId: id, requires, notionalUsd, source },
        'Order submitted',
      );

      // Auto path: execute immediately
      if (!requires) {
        return executeOrder(tenantId, actorId, id);
      }

      return order;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'order',
    meterEventType: 'api_call',
  });
}

export async function approveOrder(
  tenantId: string,
  userId: string,
  orderId: string,
): Promise<Order> {
  return runCrudOperation({
    configName: 'trade-execution',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const order = orders.get(orderId);
      if (!order || order.tenantId !== tenantId) {
        throw new AppError('Order not found', ErrorCode.NOT_FOUND);
      }
      if (order.status !== 'pending_approval') {
        throw new AppError(
          `Cannot approve order in status '${order.status}'`,
          ErrorCode.CONFLICT,
        );
      }
      order.status = 'approved';
      order.approvedBy = userId;
      orders.set(orderId, order);
      return executeOrder(tenantId, userId, orderId);
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'order',
    meterEventType: 'api_call',
  });
}

export async function rejectOrder(
  tenantId: string,
  userId: string,
  orderId: string,
  reason?: string,
): Promise<Order> {
  return runCrudOperation({
    configName: 'trade-execution',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const order = orders.get(orderId);
      if (!order || order.tenantId !== tenantId) {
        throw new AppError('Order not found', ErrorCode.NOT_FOUND);
      }
      if (order.status !== 'pending_approval') {
        throw new AppError(
          `Cannot reject order in status '${order.status}'`,
          ErrorCode.CONFLICT,
        );
      }
      order.status = 'rejected';
      order.rejectedBy = userId;
      if (reason) order.reason = reason;
      orders.set(orderId, order);
      logger.info({ orderId, userId }, 'Order rejected');
      return order;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'order',
    meterEventType: 'api_call',
  });
}

/**
 * Execute an approved order (paper fill or live broker later).
 */
export async function executeOrder(
  tenantId: string,
  actorId: string,
  orderId: string,
): Promise<Order> {
  const order = orders.get(orderId);
  if (!order || order.tenantId !== tenantId) {
    throw new AppError('Order not found', ErrorCode.NOT_FOUND);
  }
  if (order.status !== 'approved') {
    throw new AppError(
      `Cannot execute order in status '${order.status}'`,
      ErrorCode.CONFLICT,
    );
  }

  const config = await loadCfg();
  let fillPrice = order.limitPrice || 0;
  if (order.orderType === 'market' || !fillPrice) {
    const q = await getQuote(tenantId, actorId, order.symbol);
    fillPrice = q.price;
  }

  if (config.mode === 'paper') {
    await paperFill(tenantId, actorId, order, fillPrice);
  } else {
    throw new AppError(
      'Live broker execution not configured (set mode=paper or wire broker)',
      ErrorCode.INTERNAL,
    );
  }

  order.status = 'filled';
  order.fillPrice = fillPrice;
  order.filledAt = new Date().toISOString();
  order.notionalUsd = Math.round(order.qty * fillPrice * 100) / 100;
  orders.set(orderId, order);
  addDailySpent(tenantId, order.notionalUsd);

  logger.info(
    { orderId, fillPrice, notionalUsd: order.notionalUsd },
    'Order filled',
  );
  return order;
}

export async function getOrder(
  tenantId: string,
  orderId: string,
): Promise<Order | null> {
  const o = orders.get(orderId);
  if (!o || o.tenantId !== tenantId) return null;
  return o;
}

export async function listOrders(
  tenantId: string,
  portfolioId?: string,
): Promise<Order[]> {
  return [...orders.values()].filter(
    (o) =>
      o.tenantId === tenantId &&
      (!portfolioId || o.portfolioId === portfolioId),
  );
}
