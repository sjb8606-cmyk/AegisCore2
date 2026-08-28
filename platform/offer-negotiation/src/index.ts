/**
 * platform/offer-negotiation (MKT-04)
 *
 * Listing offers: make → counter → accept / decline / expire.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('offer-negotiation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTtlHours: z.number().positive().default(48),
  maxCounters: z.number().int().positive().default(5),
  minOfferBpsOfList: z.number().int().min(0).max(10000).default(5000),
});

export type OfferStatus =
  | 'pending'
  | 'countered'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn';

export interface Offer {
  id: string;
  tenantId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  listPriceCents: number;
  amountCents: number;
  status: OfferStatus;
  counterCount: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

const offers = new Map<string, Offer>();

export function __resetOfferNegotiationStore(): void {
  offers.clear();
}

function getOffer(tenantId: string, offerId: string): Offer {
  const o = offers.get(offerId);
  if (!o || o.tenantId !== tenantId) {
    throw new AppError('Offer not found', ErrorCode.NOT_FOUND);
  }
  return o;
}

function ensureNotExpired(offer: Offer): void {
  if (offer.status === 'expired') {
    throw new AppError('Offer expired', ErrorCode.CONFLICT);
  }
  if (
    (offer.status === 'pending' || offer.status === 'countered') &&
    Date.parse(offer.expiresAt) < Date.now()
  ) {
    offer.status = 'expired';
    offers.set(offer.id, offer);
    throw new AppError('Offer expired', ErrorCode.CONFLICT);
  }
}

export async function makeOffer(
  tenantId: string,
  actorId: string,
  input: {
    listingId: string;
    buyerId: string;
    sellerId: string;
    listPriceCents: number;
    amountCents: number;
    ttlHours?: number;
  },
): Promise<Offer> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('offer-negotiation', ConfigSchema);
      if (
        !input.listingId?.trim() ||
        !input.buyerId?.trim() ||
        !input.sellerId?.trim()
      ) {
        throw new AppError(
          'listingId, buyerId, sellerId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (input.listPriceCents <= 0 || input.amountCents <= 0) {
        throw new AppError('prices must be positive', ErrorCode.BAD_REQUEST);
      }
      const minAmount = Math.floor(
        (input.listPriceCents * config.minOfferBpsOfList) / 10000,
      );
      if (input.amountCents < minAmount) {
        throw new AppError(
          'Offer below minimum allowed percent of list price',
          ErrorCode.BAD_REQUEST,
        );
      }
      const existing = [...offers.values()].find(
        (o) =>
          o.tenantId === tenantId &&
          o.listingId === input.listingId &&
          o.buyerId === input.buyerId &&
          (o.status === 'pending' || o.status === 'countered'),
      );
      if (existing) {
        throw new AppError('Active offer already exists', ErrorCode.CONFLICT);
      }
      const ttl = input.ttlHours ?? config.defaultTtlHours;
      const now = new Date().toISOString();
      const offer: Offer = {
        id: crypto.randomUUID(),
        tenantId,
        listingId: input.listingId,
        buyerId: input.buyerId,
        sellerId: input.sellerId,
        listPriceCents: input.listPriceCents,
        amountCents: input.amountCents,
        status: 'pending',
        counterCount: 0,
        expiresAt: new Date(Date.now() + ttl * 3_600_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      offers.set(offer.id, offer);
      return offer;
    },
    auditAction: 'data.created',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}

export async function counterOffer(
  tenantId: string,
  actorId: string,
  offerId: string,
  amountCents: number,
): Promise<Offer> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('offer-negotiation', ConfigSchema);
      const offer = getOffer(tenantId, offerId);
      ensureNotExpired(offer);
      if (offer.status !== 'pending' && offer.status !== 'countered') {
        throw new AppError('Offer not counterable', ErrorCode.CONFLICT);
      }
      if (offer.counterCount >= config.maxCounters) {
        throw new AppError('Max counters reached', ErrorCode.CONFLICT);
      }
      if (typeof amountCents !== 'number' || amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      offer.amountCents = amountCents;
      offer.counterCount += 1;
      offer.status = 'countered';
      offer.updatedAt = new Date().toISOString();
      // refresh TTL on counter
      offer.expiresAt = new Date(
        Date.now() + config.defaultTtlHours * 3_600_000,
      ).toISOString();
      offers.set(offerId, offer);
      return offer;
    },
    auditAction: 'data.updated',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}

export async function acceptOffer(
  tenantId: string,
  actorId: string,
  offerId: string,
): Promise<Offer> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const offer = getOffer(tenantId, offerId);
      ensureNotExpired(offer);
      if (offer.status !== 'pending' && offer.status !== 'countered') {
        throw new AppError('Offer not acceptable', ErrorCode.CONFLICT);
      }
      offer.status = 'accepted';
      offer.updatedAt = new Date().toISOString();
      offers.set(offerId, offer);
      // decline other active offers on same listing
      for (const [id, o] of offers) {
        if (
          o.tenantId === tenantId &&
          o.listingId === offer.listingId &&
          id !== offerId &&
          (o.status === 'pending' || o.status === 'countered')
        ) {
          o.status = 'declined';
          o.updatedAt = new Date().toISOString();
          offers.set(id, o);
        }
      }
      logger.info(
        { offerId, listingId: offer.listingId, amountCents: offer.amountCents },
        'Offer accepted',
      );
      return offer;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}

export async function declineOffer(
  tenantId: string,
  actorId: string,
  offerId: string,
): Promise<Offer> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const offer = getOffer(tenantId, offerId);
      if (offer.status !== 'pending' && offer.status !== 'countered') {
        throw new AppError('Offer not declinable', ErrorCode.CONFLICT);
      }
      offer.status = 'declined';
      offer.updatedAt = new Date().toISOString();
      offers.set(offerId, offer);
      return offer;
    },
    auditAction: 'data.updated',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}

export async function withdrawOffer(
  tenantId: string,
  actorId: string,
  offerId: string,
): Promise<Offer> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const offer = getOffer(tenantId, offerId);
      if (offer.status !== 'pending' && offer.status !== 'countered') {
        throw new AppError('Offer not withdrawable', ErrorCode.CONFLICT);
      }
      offer.status = 'withdrawn';
      offer.updatedAt = new Date().toISOString();
      offers.set(offerId, offer);
      return offer;
    },
    auditAction: 'data.updated',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}

export async function listOffersForListing(
  tenantId: string,
  actorId: string,
  listingId: string,
): Promise<Offer[]> {
  return runCrudOperation({
    configName: 'offer-negotiation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...offers.values()]
        .filter((o) => o.tenantId === tenantId && o.listingId === listingId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    auditAction: 'data.read',
    auditResource: 'mkt_offer',
    meterEventType: 'api_call',
  });
}
