/**
 * platform/dispute-resolution (MKT-03)
 *
 * Buyer/seller disputes: open → evidence → resolve (buyer/seller/split).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('dispute-resolution');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  evidenceWindowHours: z.number().positive().default(72),
  reasonCodes: z
    .array(z.string())
    .default([
      'item_not_received',
      'not_as_described',
      'damaged',
      'wrong_item',
      'other',
    ]),
});

export type DisputeStatus =
  | 'open'
  | 'evidence'
  | 'resolved_buyer'
  | 'resolved_seller'
  | 'resolved_split'
  | 'cancelled';

export interface DisputeEvidence {
  id: string;
  party: 'buyer' | 'seller';
  note: string;
  attachmentRef: string | null;
  submittedAt: string;
}

export interface Dispute {
  id: string;
  tenantId: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  reasonCode: string;
  amountCents: number;
  status: DisputeStatus;
  evidence: DisputeEvidence[];
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const disputes = new Map<string, Dispute>();

export function __resetDisputeResolutionStore(): void {
  disputes.clear();
}

function getDisputeRecord(tenantId: string, disputeId: string): Dispute {
  const d = disputes.get(disputeId);
  if (!d || d.tenantId !== tenantId) {
    throw new AppError('Dispute not found', ErrorCode.NOT_FOUND);
  }
  return d;
}

export async function openDispute(
  tenantId: string,
  actorId: string,
  input: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    reasonCode: string;
    amountCents: number;
  },
): Promise<Dispute> {
  return runCrudOperation({
    configName: 'dispute-resolution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('dispute-resolution', ConfigSchema);
      if (!input.orderId?.trim() || !input.buyerId?.trim() || !input.sellerId?.trim()) {
        throw new AppError(
          'orderId, buyerId, sellerId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const reason = input.reasonCode?.trim().toLowerCase();
      if (
        !reason ||
        !config.reasonCodes.map((r) => r.toLowerCase()).includes(reason)
      ) {
        throw new AppError('invalid reasonCode', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.amountCents !== 'number' || input.amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      const existing = [...disputes.values()].find(
        (d) =>
          d.tenantId === tenantId &&
          d.orderId === input.orderId &&
          (d.status === 'open' || d.status === 'evidence'),
      );
      if (existing) {
        throw new AppError('Open dispute already exists for order', ErrorCode.CONFLICT);
      }
      const now = new Date().toISOString();
      const row: Dispute = {
        id: crypto.randomUUID(),
        tenantId,
        orderId: input.orderId,
        buyerId: input.buyerId,
        sellerId: input.sellerId,
        reasonCode: reason,
        amountCents: input.amountCents,
        status: 'open',
        evidence: [],
        resolutionNote: null,
        resolvedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      disputes.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'mkt_dispute',
    meterEventType: 'api_call',
  });
}

export async function submitEvidence(
  tenantId: string,
  actorId: string,
  disputeId: string,
  input: {
    party: 'buyer' | 'seller';
    note: string;
    attachmentRef?: string;
  },
): Promise<Dispute> {
  return runCrudOperation({
    configName: 'dispute-resolution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const d = getDisputeRecord(tenantId, disputeId);
      if (d.status !== 'open' && d.status !== 'evidence') {
        throw new AppError('Dispute closed', ErrorCode.CONFLICT);
      }
      if (input.party !== 'buyer' && input.party !== 'seller') {
        throw new AppError('invalid party', ErrorCode.BAD_REQUEST);
      }
      if (!input.note?.trim()) {
        throw new AppError('note required', ErrorCode.BAD_REQUEST);
      }
      d.evidence.push({
        id: crypto.randomUUID(),
        party: input.party,
        note: input.note.trim(),
        attachmentRef: input.attachmentRef?.trim() || null,
        submittedAt: new Date().toISOString(),
      });
      d.status = 'evidence';
      d.updatedAt = new Date().toISOString();
      disputes.set(disputeId, d);
      return d;
    },
    auditAction: 'data.updated',
    auditResource: 'mkt_dispute',
    meterEventType: 'api_call',
  });
}

export async function resolveDispute(
  tenantId: string,
  actorId: string,
  disputeId: string,
  input: {
    outcome: 'buyer' | 'seller' | 'split';
    note?: string;
  },
): Promise<Dispute> {
  return runCrudOperation({
    configName: 'dispute-resolution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const d = getDisputeRecord(tenantId, disputeId);
      if (d.status !== 'open' && d.status !== 'evidence') {
        throw new AppError('Dispute already resolved', ErrorCode.CONFLICT);
      }
      if (!['buyer', 'seller', 'split'].includes(input.outcome)) {
        throw new AppError('invalid outcome', ErrorCode.BAD_REQUEST);
      }
      d.status =
        input.outcome === 'buyer'
          ? 'resolved_buyer'
          : input.outcome === 'seller'
            ? 'resolved_seller'
            : 'resolved_split';
      d.resolutionNote = input.note?.trim() || null;
      d.resolvedBy = actorId;
      d.updatedAt = new Date().toISOString();
      disputes.set(disputeId, d);
      logger.info(
        { disputeId, outcome: input.outcome, orderId: d.orderId },
        'Dispute resolved',
      );
      return d;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_dispute',
    meterEventType: 'api_call',
  });
}

export async function getDispute(
  tenantId: string,
  actorId: string,
  disputeId: string,
): Promise<Dispute> {
  return runCrudOperation({
    configName: 'dispute-resolution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getDisputeRecord(tenantId, disputeId),
    auditAction: 'data.read',
    auditResource: 'mkt_dispute',
    meterEventType: 'api_call',
  });
}

export async function listOpenDisputes(
  tenantId: string,
  actorId: string,
): Promise<Dispute[]> {
  return runCrudOperation({
    configName: 'dispute-resolution',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...disputes.values()]
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            (d.status === 'open' || d.status === 'evidence'),
        )
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    auditAction: 'data.read',
    auditResource: 'mkt_dispute',
    meterEventType: 'api_call',
  });
}
