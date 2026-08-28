/**
 * platform/return-merchandise-auth (EC-04)
 *
 * RMA state machine: requested → approved/rejected → received → refunded.
 * Restocking fee + reason codes.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('return-merchandise-auth');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultRestockingFeeBps: z.number().int().min(0).max(10000).default(0),
  returnWindowDays: z.number().int().positive().default(30),
  reasonCodes: z
    .array(z.string())
    .default([
      'damaged',
      'wrong_item',
      'not_as_described',
      'changed_mind',
      'other',
    ]),
});

export type RmaStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'received'
  | 'refunded'
  | 'cancelled';

export interface RmaLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Rma {
  id: string;
  tenantId: string;
  orderId: string;
  status: RmaStatus;
  reasonCode: string;
  notes: string | null;
  lines: RmaLine[];
  restockingFeeBps: number;
  refundCents: number | null;
  createdAt: string;
  updatedAt: string;
}

const rmas = new Map<string, Rma>();

export function __resetRmaStore(): void {
  rmas.clear();
}

function getRmaRecord(tenantId: string, rmaId: string): Rma {
  const r = rmas.get(rmaId);
  if (!r || r.tenantId !== tenantId) {
    throw new AppError('RMA not found', ErrorCode.NOT_FOUND);
  }
  return r;
}

function lineTotal(lines: RmaLine[]): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
}

function computeRefund(lines: RmaLine[], feeBps: number): number {
  const total = lineTotal(lines);
  const fee = Math.floor((total * feeBps) / 10000);
  return Math.max(0, total - fee);
}

export async function requestRma(
  tenantId: string,
  actorId: string,
  input: {
    orderId: string;
    reasonCode: string;
    notes?: string;
    lines: RmaLine[];
    restockingFeeBps?: number;
  },
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('return-merchandise-auth', ConfigSchema);
      if (!input.orderId?.trim()) {
        throw new AppError('orderId required', ErrorCode.BAD_REQUEST);
      }
      const reason = input.reasonCode?.trim().toLowerCase();
      if (!reason || !config.reasonCodes.map((r) => r.toLowerCase()).includes(reason)) {
        throw new AppError('invalid reasonCode', ErrorCode.BAD_REQUEST);
      }
      if (!input.lines?.length) {
        throw new AppError('lines required', ErrorCode.BAD_REQUEST);
      }
      for (const line of input.lines) {
        if (!line.sku?.trim() || line.quantity <= 0 || line.unitPriceCents < 0) {
          throw new AppError('invalid line item', ErrorCode.BAD_REQUEST);
        }
      }
      const feeBps = input.restockingFeeBps ?? config.defaultRestockingFeeBps;
      const now = new Date().toISOString();
      const rma: Rma = {
        id: crypto.randomUUID(),
        tenantId,
        orderId: input.orderId,
        status: 'requested',
        reasonCode: reason,
        notes: input.notes?.trim() || null,
        lines: input.lines.map((l) => ({
          sku: l.sku.trim(),
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
        })),
        restockingFeeBps: feeBps,
        refundCents: null,
        createdAt: now,
        updatedAt: now,
      };
      rmas.set(rma.id, rma);
      return rma;
    },
    auditAction: 'data.created',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}

export async function approveRma(
  tenantId: string,
  actorId: string,
  rmaId: string,
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rma = getRmaRecord(tenantId, rmaId);
      if (rma.status !== 'requested') {
        throw new AppError('RMA not in requested state', ErrorCode.CONFLICT);
      }
      rma.status = 'approved';
      rma.updatedAt = new Date().toISOString();
      rmas.set(rmaId, rma);
      return rma;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}

export async function rejectRma(
  tenantId: string,
  actorId: string,
  rmaId: string,
  notes?: string,
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rma = getRmaRecord(tenantId, rmaId);
      if (rma.status !== 'requested' && rma.status !== 'approved') {
        throw new AppError('RMA cannot be rejected from current state', ErrorCode.CONFLICT);
      }
      rma.status = 'rejected';
      if (notes?.trim()) rma.notes = notes.trim();
      rma.updatedAt = new Date().toISOString();
      rmas.set(rmaId, rma);
      return rma;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}

export async function markReceived(
  tenantId: string,
  actorId: string,
  rmaId: string,
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rma = getRmaRecord(tenantId, rmaId);
      if (rma.status !== 'approved') {
        throw new AppError('RMA must be approved before receive', ErrorCode.CONFLICT);
      }
      rma.status = 'received';
      rma.updatedAt = new Date().toISOString();
      rmas.set(rmaId, rma);
      return rma;
    },
    auditAction: 'data.updated',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}

export async function completeRefund(
  tenantId: string,
  actorId: string,
  rmaId: string,
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const rma = getRmaRecord(tenantId, rmaId);
      if (rma.status !== 'received') {
        throw new AppError('RMA must be received before refund', ErrorCode.CONFLICT);
      }
      rma.refundCents = computeRefund(rma.lines, rma.restockingFeeBps);
      rma.status = 'refunded';
      rma.updatedAt = new Date().toISOString();
      rmas.set(rmaId, rma);
      logger.info(
        { rmaId, refundCents: rma.refundCents },
        'RMA refunded',
      );
      return rma;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}

export async function getRma(
  tenantId: string,
  actorId: string,
  rmaId: string,
): Promise<Rma> {
  return runCrudOperation({
    configName: 'return-merchandise-auth',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getRmaRecord(tenantId, rmaId),
    auditAction: 'data.read',
    auditResource: 'ec_rma',
    meterEventType: 'api_call',
  });
}
