/**
 * platform/seller-payout-ledger (MKT-02)
 *
 * Sale → platform fee → hold → available → payout batch.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('seller-payout-ledger');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  platformFeeBps: z.number().int().min(0).max(10000).default(1000),
  holdDays: z.number().int().nonnegative().default(7),
});

export type LedgerEntryType = 'sale' | 'fee' | 'hold_release' | 'payout' | 'adjustment';

export interface SellerBalance {
  tenantId: string;
  sellerId: string;
  pendingCents: number;
  availableCents: number;
  paidCents: number;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  sellerId: string;
  type: LedgerEntryType;
  amountCents: number;
  orderId: string | null;
  availableAt: string | null;
  createdAt: string;
}

export interface PayoutBatch {
  id: string;
  tenantId: string;
  sellerId: string;
  amountCents: number;
  entryIds: string[];
  createdAt: string;
}

const balances = new Map<string, SellerBalance>();
const entries = new Map<string, LedgerEntry>();
const payouts = new Map<string, PayoutBatch>();

export function __resetSellerPayoutStore(): void {
  balances.clear();
  entries.clear();
  payouts.clear();
}

function balKey(tenantId: string, sellerId: string): string {
  return tenantId + ':' + sellerId;
}

function getBalance(tenantId: string, sellerId: string): SellerBalance {
  const k = balKey(tenantId, sellerId);
  let b = balances.get(k);
  if (!b) {
    b = {
      tenantId,
      sellerId,
      pendingCents: 0,
      availableCents: 0,
      paidCents: 0,
    };
    balances.set(k, b);
  }
  return b;
}

export async function recordSale(
  tenantId: string,
  actorId: string,
  input: {
    sellerId: string;
    orderId: string;
    grossCents: number;
  },
): Promise<{ netCents: number; feeCents: number; balance: SellerBalance }> {
  return runCrudOperation({
    configName: 'seller-payout-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('seller-payout-ledger', ConfigSchema);
      if (!input.sellerId?.trim() || !input.orderId?.trim()) {
        throw new AppError('sellerId and orderId required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.grossCents !== 'number' || input.grossCents <= 0) {
        throw new AppError('grossCents must be positive', ErrorCode.BAD_REQUEST);
      }
      const feeCents = Math.floor((input.grossCents * config.platformFeeBps) / 10000);
      const netCents = input.grossCents - feeCents;
      const availableAt = new Date(
        Date.now() + config.holdDays * 86_400_000,
      ).toISOString();

      const saleEntry: LedgerEntry = {
        id: crypto.randomUUID(),
        tenantId,
        sellerId: input.sellerId,
        type: 'sale',
        amountCents: netCents,
        orderId: input.orderId,
        availableAt,
        createdAt: new Date().toISOString(),
      };
      const feeEntry: LedgerEntry = {
        id: crypto.randomUUID(),
        tenantId,
        sellerId: input.sellerId,
        type: 'fee',
        amountCents: -feeCents,
        orderId: input.orderId,
        availableAt: null,
        createdAt: new Date().toISOString(),
      };
      entries.set(saleEntry.id, saleEntry);
      entries.set(feeEntry.id, feeEntry);

      const bal = getBalance(tenantId, input.sellerId);
      bal.pendingCents += netCents;
      balances.set(balKey(tenantId, input.sellerId), bal);
      return { netCents, feeCents, balance: bal };
    },
    auditAction: 'data.created',
    auditResource: 'mkt_seller_ledger',
    meterEventType: 'api_call',
  });
}

export async function releaseHolds(
  tenantId: string,
  actorId: string,
  sellerId?: string,
): Promise<{ releasedCents: number; count: number }> {
  return runCrudOperation({
    configName: 'seller-payout-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const now = Date.now();
      let releasedCents = 0;
      let count = 0;
      for (const [id, e] of entries) {
        if (e.tenantId !== tenantId) continue;
        if (sellerId && e.sellerId !== sellerId) continue;
        if (e.type !== 'sale') continue;
        if (!e.availableAt || Date.parse(e.availableAt) > now) continue;
        // mark released by converting pending → available once
        if ((e as LedgerEntry & { released?: boolean }).released) continue;
        (e as LedgerEntry & { released?: boolean }).released = true;
        entries.set(id, e);
        const bal = getBalance(tenantId, e.sellerId);
        bal.pendingCents = Math.max(0, bal.pendingCents - e.amountCents);
        bal.availableCents += e.amountCents;
        balances.set(balKey(tenantId, e.sellerId), bal);
        releasedCents += e.amountCents;
        count += 1;
      }
      return { releasedCents, count };
    },
    auditAction: 'data.updated',
    auditResource: 'mkt_seller_ledger',
    meterEventType: 'api_call',
  });
}

export async function createPayout(
  tenantId: string,
  actorId: string,
  sellerId: string,
  amountCents?: number,
): Promise<PayoutBatch> {
  return runCrudOperation({
    configName: 'seller-payout-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!sellerId?.trim()) {
        throw new AppError('sellerId required', ErrorCode.BAD_REQUEST);
      }
      const bal = getBalance(tenantId, sellerId);
      const pay = amountCents ?? bal.availableCents;
      if (pay <= 0) {
        throw new AppError('Nothing available to payout', ErrorCode.CONFLICT);
      }
      if (pay > bal.availableCents) {
        throw new AppError('Amount exceeds available balance', ErrorCode.CONFLICT);
      }
      bal.availableCents -= pay;
      bal.paidCents += pay;
      balances.set(balKey(tenantId, sellerId), bal);

      const entry: LedgerEntry = {
        id: crypto.randomUUID(),
        tenantId,
        sellerId,
        type: 'payout',
        amountCents: -pay,
        orderId: null,
        availableAt: null,
        createdAt: new Date().toISOString(),
      };
      entries.set(entry.id, entry);

      const batch: PayoutBatch = {
        id: crypto.randomUUID(),
        tenantId,
        sellerId,
        amountCents: pay,
        entryIds: [entry.id],
        createdAt: new Date().toISOString(),
      };
      payouts.set(batch.id, batch);
      logger.info({ sellerId, amountCents: pay }, 'Seller payout created');
      return batch;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_seller_payout',
    meterEventType: 'api_call',
  });
}

export async function getSellerBalance(
  tenantId: string,
  actorId: string,
  sellerId: string,
): Promise<SellerBalance> {
  return runCrudOperation({
    configName: 'seller-payout-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getBalance(tenantId, sellerId),
    auditAction: 'data.read',
    auditResource: 'mkt_seller_ledger',
    meterEventType: 'api_call',
  });
}
