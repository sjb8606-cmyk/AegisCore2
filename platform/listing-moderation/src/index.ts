/**
 * platform/listing-moderation (MKT-01)
 *
 * Listing publish states, policy flags, approve/reject/takedown.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('listing-moderation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireApprovalBeforePublic: z.boolean().default(true),
  flagReasons: z
    .array(z.string())
    .default([
      'prohibited_item',
      'misleading',
      'copyright',
      'spam',
      'other',
    ]),
});

export type ListingModStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'taken_down';

export interface ModeratedListing {
  id: string;
  tenantId: string;
  sellerId: string;
  title: string;
  status: ListingModStatus;
  flags: string[];
  rejectionReason: string | null;
  takedownReason: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const listings = new Map<string, ModeratedListing>();

export function __resetListingModerationStore(): void {
  listings.clear();
}

function getListing(tenantId: string, listingId: string): ModeratedListing {
  const l = listings.get(listingId);
  if (!l || l.tenantId !== tenantId) {
    throw new AppError('Listing not found', ErrorCode.NOT_FOUND);
  }
  return l;
}

export async function submitListing(
  tenantId: string,
  actorId: string,
  input: { sellerId: string; title: string },
): Promise<ModeratedListing> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('listing-moderation', ConfigSchema);
      if (!input.sellerId?.trim() || !input.title?.trim()) {
        throw new AppError('sellerId and title required', ErrorCode.BAD_REQUEST);
      }
      const now = new Date().toISOString();
      const row: ModeratedListing = {
        id: crypto.randomUUID(),
        tenantId,
        sellerId: input.sellerId,
        title: input.title.trim(),
        status: config.requireApprovalBeforePublic ? 'pending_review' : 'approved',
        flags: [],
        rejectionReason: null,
        takedownReason: null,
        reviewedBy: config.requireApprovalBeforePublic ? null : actorId,
        createdAt: now,
        updatedAt: now,
      };
      listings.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}

export async function flagListing(
  tenantId: string,
  actorId: string,
  listingId: string,
  reason: string,
): Promise<ModeratedListing> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('listing-moderation', ConfigSchema);
      const r = reason?.trim().toLowerCase();
      if (!r || !config.flagReasons.map((x) => x.toLowerCase()).includes(r)) {
        throw new AppError('invalid flag reason', ErrorCode.BAD_REQUEST);
      }
      const listing = getListing(tenantId, listingId);
      if (!listing.flags.includes(r)) listing.flags.push(r);
      listing.updatedAt = new Date().toISOString();
      listings.set(listingId, listing);
      return listing;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}

export async function approveListing(
  tenantId: string,
  actorId: string,
  listingId: string,
): Promise<ModeratedListing> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const listing = getListing(tenantId, listingId);
      if (
        listing.status !== 'pending_review' &&
        listing.status !== 'rejected' &&
        listing.status !== 'taken_down'
      ) {
        throw new AppError('Listing not reviewable', ErrorCode.CONFLICT);
      }
      listing.status = 'approved';
      listing.rejectionReason = null;
      listing.takedownReason = null;
      listing.reviewedBy = actorId;
      listing.updatedAt = new Date().toISOString();
      listings.set(listingId, listing);
      return listing;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}

export async function rejectListing(
  tenantId: string,
  actorId: string,
  listingId: string,
  reason: string,
): Promise<ModeratedListing> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!reason?.trim()) {
        throw new AppError('reason required', ErrorCode.BAD_REQUEST);
      }
      const listing = getListing(tenantId, listingId);
      listing.status = 'rejected';
      listing.rejectionReason = reason.trim();
      listing.reviewedBy = actorId;
      listing.updatedAt = new Date().toISOString();
      listings.set(listingId, listing);
      return listing;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}

export async function takedownListing(
  tenantId: string,
  actorId: string,
  listingId: string,
  reason: string,
): Promise<ModeratedListing> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!reason?.trim()) {
        throw new AppError('reason required', ErrorCode.BAD_REQUEST);
      }
      const listing = getListing(tenantId, listingId);
      if (listing.status === 'taken_down') {
        throw new AppError('Already taken down', ErrorCode.CONFLICT);
      }
      listing.status = 'taken_down';
      listing.takedownReason = reason.trim();
      listing.reviewedBy = actorId;
      listing.updatedAt = new Date().toISOString();
      listings.set(listingId, listing);
      logger.warn({ listingId, reason }, 'Listing taken down');
      return listing;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}

export async function assertListingPublic(
  tenantId: string,
  listingId: string,
): Promise<{ public: boolean }> {
  const listing = getListing(tenantId, listingId);
  if (listing.status !== 'approved') {
    throw new AppError('Listing not public', ErrorCode.FORBIDDEN);
  }
  return { public: true };
}

export async function listPendingReview(
  tenantId: string,
  actorId: string,
): Promise<ModeratedListing[]> {
  return runCrudOperation({
    configName: 'listing-moderation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...listings.values()]
        .filter((l) => l.tenantId === tenantId && l.status === 'pending_review')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    auditAction: 'data.read',
    auditResource: 'mkt_listing',
    meterEventType: 'api_call',
  });
}
