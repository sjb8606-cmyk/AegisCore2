/**
 * platform/receipt-reprint-audit (POS-05)
 *
 * Receipt reprint tracking with per-transaction and session limits (fraud signal).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('receipt-reprint-audit');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxReprintsPerTransaction: z.number().int().positive().default(3),
  maxReprintsPerSession: z.number().int().positive().default(50),
  alertOnLimit: z.boolean().default(true),
});

export interface ReceiptReprint {
  id: string;
  tenantId: string;
  transactionId: string;
  sessionId: string | null;
  registerId: string | null;
  cashierId: string;
  reprintNumber: number;
  reason: string | null;
  createdAt: string;
}

const reprints = new Map<string, ReceiptReprint>();

export function __resetReceiptReprintStore(): void {
  reprints.clear();
}

function countForTransaction(tenantId: string, transactionId: string): number {
  return [...reprints.values()].filter(
    (r) => r.tenantId === tenantId && r.transactionId === transactionId,
  ).length;
}

function countForSession(tenantId: string, sessionId: string): number {
  return [...reprints.values()].filter(
    (r) => r.tenantId === tenantId && r.sessionId === sessionId,
  ).length;
}

export async function recordReprint(
  tenantId: string,
  actorId: string,
  input: {
    transactionId: string;
    cashierId: string;
    sessionId?: string;
    registerId?: string;
    reason?: string;
  },
): Promise<ReceiptReprint> {
  return runCrudOperation({
    configName: 'receipt-reprint-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('receipt-reprint-audit', ConfigSchema);
      if (!input.transactionId?.trim() || !input.cashierId?.trim()) {
        throw new AppError(
          'transactionId and cashierId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const txCount = countForTransaction(tenantId, input.transactionId);
      if (txCount >= config.maxReprintsPerTransaction) {
        if (config.alertOnLimit) {
          logger.warn(
            { transactionId: input.transactionId, txCount },
            'Receipt reprint limit hit for transaction',
          );
        }
        throw new AppError(
          'Max reprints for this transaction reached',
          ErrorCode.CONFLICT,
        );
      }
      if (input.sessionId) {
        const sessCount = countForSession(tenantId, input.sessionId);
        if (sessCount >= config.maxReprintsPerSession) {
          if (config.alertOnLimit) {
            logger.warn(
              { sessionId: input.sessionId, sessCount },
              'Receipt reprint limit hit for session',
            );
          }
          throw new AppError(
            'Max reprints for this session reached',
            ErrorCode.CONFLICT,
          );
        }
      }
      const row: ReceiptReprint = {
        id: crypto.randomUUID(),
        tenantId,
        transactionId: input.transactionId,
        sessionId: input.sessionId || null,
        registerId: input.registerId || null,
        cashierId: input.cashierId,
        reprintNumber: txCount + 1,
        reason: input.reason?.trim() || null,
        createdAt: new Date().toISOString(),
      };
      reprints.set(row.id, row);
      return row;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'pos_receipt_reprint',
    meterEventType: 'api_call',
  });
}

export async function getTransactionReprints(
  tenantId: string,
  actorId: string,
  transactionId: string,
): Promise<ReceiptReprint[]> {
  return runCrudOperation({
    configName: 'receipt-reprint-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...reprints.values()]
        .filter(
          (r) => r.tenantId === tenantId && r.transactionId === transactionId,
        )
        .sort((a, b) => a.reprintNumber - b.reprintNumber),
    auditAction: 'data.read',
    auditResource: 'pos_receipt_reprint',
    meterEventType: 'api_call',
  });
}

export async function getHighReprintTransactions(
  tenantId: string,
  actorId: string,
  minReprints = 2,
  sinceIso?: string,
): Promise<Array<{ transactionId: string; count: number }>> {
  return runCrudOperation({
    configName: 'receipt-reprint-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const since = sinceIso ? Date.parse(sinceIso) : 0;
      if (sinceIso && Number.isNaN(since)) {
        throw new AppError('invalid since', ErrorCode.BAD_REQUEST);
      }
      const counts = new Map<string, number>();
      for (const r of reprints.values()) {
        if (r.tenantId !== tenantId) continue;
        if (Date.parse(r.createdAt) < since) continue;
        counts.set(r.transactionId, (counts.get(r.transactionId) || 0) + 1);
      }
      return [...counts.entries()]
        .filter(([, c]) => c >= minReprints)
        .map(([transactionId, count]) => ({ transactionId, count }))
        .sort((a, b) => b.count - a.count);
    },
    auditAction: 'data.read',
    auditResource: 'pos_receipt_reprint',
    meterEventType: 'api_call',
  });
}
