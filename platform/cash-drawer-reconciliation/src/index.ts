/**
 * platform/cash-drawer-reconciliation (POS-01)
 *
 * Open float, cash tenders in/out, expected vs counted, variance reasons.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('cash-drawer-reconciliation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxVarianceCentsWithoutNote: z.number().int().nonnegative().default(100),
  varianceReasonCodes: z
    .array(z.string())
    .default(['count_error', 'theft', 'change_error', 'other']),
});

export type DrawerStatus = 'open' | 'closed';

export interface CashDrawerSession {
  id: string;
  tenantId: string;
  registerId: string;
  openedBy: string;
  closedBy: string | null;
  openingFloatCents: number;
  cashSalesCents: number;
  cashRefundsCents: number;
  paidInsCents: number;
  paidOutsCents: number;
  expectedCents: number;
  countedCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
  status: DrawerStatus;
  openedAt: string;
  closedAt: string | null;
}

const sessions = new Map<string, CashDrawerSession>();

export function __resetCashDrawerStore(): void {
  sessions.clear();
}

function getSession(tenantId: string, sessionId: string): CashDrawerSession {
  const s = sessions.get(sessionId);
  if (!s || s.tenantId !== tenantId) {
    throw new AppError('Drawer session not found', ErrorCode.NOT_FOUND);
  }
  return s;
}

function recalcExpected(s: CashDrawerSession): void {
  s.expectedCents =
    s.openingFloatCents +
    s.cashSalesCents -
    s.cashRefundsCents +
    s.paidInsCents -
    s.paidOutsCents;
}

export async function openDrawer(
  tenantId: string,
  actorId: string,
  input: {
    registerId: string;
    openingFloatCents: number;
  },
): Promise<CashDrawerSession> {
  return runCrudOperation({
    configName: 'cash-drawer-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.registerId?.trim()) {
        throw new AppError('registerId required', ErrorCode.BAD_REQUEST);
      }
      if (
        typeof input.openingFloatCents !== 'number' ||
        input.openingFloatCents < 0
      ) {
        throw new AppError('openingFloatCents must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const active = [...sessions.values()].find(
        (s) =>
          s.tenantId === tenantId &&
          s.registerId === input.registerId &&
          s.status === 'open',
      );
      if (active) {
        throw new AppError('Register already has an open drawer', ErrorCode.CONFLICT);
      }
      const session: CashDrawerSession = {
        id: crypto.randomUUID(),
        tenantId,
        registerId: input.registerId,
        openedBy: actorId,
        closedBy: null,
        openingFloatCents: input.openingFloatCents,
        cashSalesCents: 0,
        cashRefundsCents: 0,
        paidInsCents: 0,
        paidOutsCents: 0,
        expectedCents: input.openingFloatCents,
        countedCents: null,
        varianceCents: null,
        varianceReason: null,
        status: 'open',
        openedAt: new Date().toISOString(),
        closedAt: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    auditAction: 'data.created',
    auditResource: 'pos_cash_drawer',
    meterEventType: 'api_call',
  });
}

export async function recordCashSale(
  tenantId: string,
  actorId: string,
  sessionId: string,
  amountCents: number,
): Promise<CashDrawerSession> {
  return adjust(tenantId, actorId, sessionId, 'sale', amountCents);
}

export async function recordCashRefund(
  tenantId: string,
  actorId: string,
  sessionId: string,
  amountCents: number,
): Promise<CashDrawerSession> {
  return adjust(tenantId, actorId, sessionId, 'refund', amountCents);
}

export async function recordPaidIn(
  tenantId: string,
  actorId: string,
  sessionId: string,
  amountCents: number,
): Promise<CashDrawerSession> {
  return adjust(tenantId, actorId, sessionId, 'paid_in', amountCents);
}

export async function recordPaidOut(
  tenantId: string,
  actorId: string,
  sessionId: string,
  amountCents: number,
): Promise<CashDrawerSession> {
  return adjust(tenantId, actorId, sessionId, 'paid_out', amountCents);
}

async function adjust(
  tenantId: string,
  actorId: string,
  sessionId: string,
  kind: 'sale' | 'refund' | 'paid_in' | 'paid_out',
  amountCents: number,
): Promise<CashDrawerSession> {
  return runCrudOperation({
    configName: 'cash-drawer-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (typeof amountCents !== 'number' || amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      const s = getSession(tenantId, sessionId);
      if (s.status !== 'open') {
        throw new AppError('Drawer is closed', ErrorCode.CONFLICT);
      }
      if (kind === 'sale') s.cashSalesCents += amountCents;
      if (kind === 'refund') s.cashRefundsCents += amountCents;
      if (kind === 'paid_in') s.paidInsCents += amountCents;
      if (kind === 'paid_out') s.paidOutsCents += amountCents;
      recalcExpected(s);
      sessions.set(sessionId, s);
      return s;
    },
    auditAction: 'data.updated',
    auditResource: 'pos_cash_drawer',
    meterEventType: 'api_call',
  });
}

export async function closeDrawer(
  tenantId: string,
  actorId: string,
  sessionId: string,
  input: {
    countedCents: number;
    varianceReason?: string;
  },
): Promise<CashDrawerSession> {
  return runCrudOperation({
    configName: 'cash-drawer-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('cash-drawer-reconciliation', ConfigSchema);
      const s = getSession(tenantId, sessionId);
      if (s.status !== 'open') {
        throw new AppError('Drawer already closed', ErrorCode.CONFLICT);
      }
      if (typeof input.countedCents !== 'number' || input.countedCents < 0) {
        throw new AppError('countedCents must be >= 0', ErrorCode.BAD_REQUEST);
      }
      recalcExpected(s);
      const variance = input.countedCents - s.expectedCents;
      if (
        Math.abs(variance) > config.maxVarianceCentsWithoutNote &&
        !input.varianceReason?.trim()
      ) {
        throw new AppError(
          'varianceReason required when variance exceeds threshold',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (input.varianceReason) {
        const r = input.varianceReason.trim().toLowerCase();
        if (
          config.varianceReasonCodes.length > 0 &&
          !config.varianceReasonCodes.map((x) => x.toLowerCase()).includes(r)
        ) {
          throw new AppError('invalid varianceReason', ErrorCode.BAD_REQUEST);
        }
        s.varianceReason = r;
      }
      s.countedCents = input.countedCents;
      s.varianceCents = variance;
      s.status = 'closed';
      s.closedBy = actorId;
      s.closedAt = new Date().toISOString();
      sessions.set(sessionId, s);
      if (variance !== 0) {
        logger.warn(
          { sessionId, variance, expected: s.expectedCents, counted: input.countedCents },
          'Cash variance on close',
        );
      }
      return s;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'pos_cash_drawer',
    meterEventType: 'api_call',
  });
}

export async function getDrawerSession(
  tenantId: string,
  actorId: string,
  sessionId: string,
): Promise<CashDrawerSession> {
  return runCrudOperation({
    configName: 'cash-drawer-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getSession(tenantId, sessionId),
    auditAction: 'data.read',
    auditResource: 'pos_cash_drawer',
    meterEventType: 'api_call',
  });
}
