/**
 * platform/points-ledger
 *
 * Append-only points ledger: credit / debit with balance_after + full history.
 * Balance is always the latest balance_after for the user (not a separate mutable counter).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('points-ledger');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  earningRules: z
    .record(z.number())
    .default({ referral: 100, purchase: 10, signup: 50 }),
  redemptionRate: z.number().positive().default(0.01), // points → currency
});

export type TxType = 'credit' | 'debit';

export interface PointTransaction {
  id: string;
  tenantId: string;
  userId: string;
  points: number;
  type: TxType;
  reason: string;
  relatedId: string | null;
  balanceAfter: number;
  timestamp: string;
}

const txns = new Map<string, PointTransaction[]>(); // key tenant:userId

export function __resetPointsLedgerStore(): void {
  txns.clear();
}

function key(tenantId: string, userId: string): string {
  return tenantId + ':' + userId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('points-ledger', ConfigSchema);
}

export function currentBalance(tenantId: string, userId: string): number {
  const list = txns.get(key(tenantId, userId)) || [];
  if (!list.length) return 0;
  return list[list.length - 1].balanceAfter;
}

export async function credit(
  tenantId: string,
  actorId: string,
  input: {
    userId: string;
    points?: number;
    reason: string;
    relatedId?: string;
  },
): Promise<PointTransaction> {
  return runCrudOperation({
    configName: 'points-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.userId?.trim() || !input.reason?.trim()) {
        throw new AppError('userId and reason required', ErrorCode.BAD_REQUEST);
      }
      let points = input.points;
      if (points === undefined) {
        points = config.earningRules[input.reason];
      }
      if (typeof points !== 'number' || points <= 0 || Number.isNaN(points)) {
        throw new AppError('points must be a positive number', ErrorCode.BAD_REQUEST);
      }
      const k = key(tenantId, input.userId);
      const list = txns.get(k) || [];
      const prev = list.length ? list[list.length - 1].balanceAfter : 0;
      const tx: PointTransaction = {
        id: crypto.randomUUID(),
        tenantId,
        userId: input.userId,
        points,
        type: 'credit',
        reason: input.reason.trim(),
        relatedId: input.relatedId || null,
        balanceAfter: prev + points,
        timestamp: new Date().toISOString(),
      };
      list.push(tx);
      txns.set(k, list);
      logger.info({ userId: input.userId, points, balance: tx.balanceAfter }, 'Points credited');
      return tx;
    },
    auditAction: 'data.created',
    auditResource: 'point_transaction',
    meterEventType: 'api_call',
  });
}

export async function debit(
  tenantId: string,
  actorId: string,
  input: {
    userId: string;
    points: number;
    reason: string;
    relatedId?: string;
  },
): Promise<PointTransaction> {
  return runCrudOperation({
    configName: 'points-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.userId?.trim() || !input.reason?.trim()) {
        throw new AppError('userId and reason required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.points !== 'number' || input.points <= 0) {
        throw new AppError('points must be a positive number', ErrorCode.BAD_REQUEST);
      }
      const k = key(tenantId, input.userId);
      const list = txns.get(k) || [];
      const prev = list.length ? list[list.length - 1].balanceAfter : 0;
      const next = prev - input.points;
      if (next < 0 && !config.allowNegative) {
        throw new AppError('Insufficient points', ErrorCode.FORBIDDEN);
      }
      const tx: PointTransaction = {
        id: crypto.randomUUID(),
        tenantId,
        userId: input.userId,
        points: input.points,
        type: 'debit',
        reason: input.reason.trim(),
        relatedId: input.relatedId || null,
        balanceAfter: next,
        timestamp: new Date().toISOString(),
      };
      list.push(tx);
      txns.set(k, list);
      logger.info({ userId: input.userId, points: input.points, balance: next }, 'Points debited');
      return tx;
    },
    auditAction: 'data.created',
    auditResource: 'point_transaction',
    meterEventType: 'api_call',
  });
}

export async function getBalance(
  tenantId: string,
  userId: string,
): Promise<{ userId: string; balance: number }> {
  return { userId, balance: currentBalance(tenantId, userId) };
}

export async function getHistory(
  tenantId: string,
  userId: string,
): Promise<PointTransaction[]> {
  return [...(txns.get(key(tenantId, userId)) || [])];
}

export async function redeemValue(
  tenantId: string,
  userId: string,
): Promise<{ points: number; currencyValue: number }> {
  const config = await loadCfg();
  const points = currentBalance(tenantId, userId);
  return {
    points,
    currencyValue: Math.round(points * config.redemptionRate * 100) / 100,
  };
}
