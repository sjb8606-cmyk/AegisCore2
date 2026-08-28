/**
 * platform/promotion-engine (EC-02)
 *
 * Promo codes: percent/fixed off, min subtotal, stacking policy, redemptions.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('promotion-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultStackPolicy: z.enum(['none', 'with_other']).default('none'),
  maxCodesPerCart: z.number().int().positive().default(1),
});

export type DiscountType = 'percent' | 'fixed_cents';
export type StackPolicy = 'none' | 'with_other';

export interface Promotion {
  id: string;
  tenantId: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minSubtotalCents: number;
  stackPolicy: StackPolicy;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface AppliedDiscount {
  code: string;
  promotionId: string;
  discountCents: number;
}

const promos = new Map<string, Promotion>();
/** tenant:code → promotion id */
const codeIndex = new Map<string, string>();
const redemptions: Array<{
  id: string;
  tenantId: string;
  promotionId: string;
  cartId: string;
  discountCents: number;
  createdAt: string;
}> = [];

export function __resetPromotionEngineStore(): void {
  promos.clear();
  codeIndex.clear();
  redemptions.length = 0;
}

function codeKey(tenantId: string, code: string): string {
  return tenantId + ':' + code.trim().toUpperCase();
}

export async function createPromotion(
  tenantId: string,
  actorId: string,
  input: {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    minSubtotalCents?: number;
    stackPolicy?: StackPolicy;
    maxRedemptions?: number;
    startsAt?: string;
    endsAt?: string;
  },
): Promise<Promotion> {
  return runCrudOperation({
    configName: 'promotion-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('promotion-engine', ConfigSchema);
      if (!input.code?.trim()) {
        throw new AppError('code required', ErrorCode.BAD_REQUEST);
      }
      if (!['percent', 'fixed_cents'].includes(input.discountType)) {
        throw new AppError('invalid discountType', ErrorCode.BAD_REQUEST);
      }
      if (input.discountType === 'percent') {
        if (input.discountValue <= 0 || input.discountValue > 100) {
          throw new AppError('percent must be 1-100', ErrorCode.BAD_REQUEST);
        }
      } else if (input.discountValue <= 0) {
        throw new AppError('fixed discount must be positive', ErrorCode.BAD_REQUEST);
      }
      const normalized = input.code.trim().toUpperCase();
      if (codeIndex.has(codeKey(tenantId, normalized))) {
        throw new AppError('code already exists', ErrorCode.CONFLICT);
      }
      const promo: Promotion = {
        id: crypto.randomUUID(),
        tenantId,
        code: normalized,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minSubtotalCents: input.minSubtotalCents ?? 0,
        stackPolicy: input.stackPolicy ?? config.defaultStackPolicy,
        maxRedemptions: input.maxRedemptions ?? null,
        redemptionCount: 0,
        startsAt: input.startsAt ? new Date(Date.parse(input.startsAt)).toISOString() : null,
        endsAt: input.endsAt ? new Date(Date.parse(input.endsAt)).toISOString() : null,
        active: true,
        createdAt: new Date().toISOString(),
      };
      promos.set(promo.id, promo);
      codeIndex.set(codeKey(tenantId, normalized), promo.id);
      return promo;
    },
    auditAction: 'data.created',
    auditResource: 'ec_promotion',
    meterEventType: 'api_call',
  });
}

function assertPromoLive(promo: Promotion, now = Date.now()): void {
  if (!promo.active) {
    throw new AppError('Promotion inactive', ErrorCode.FORBIDDEN);
  }
  if (promo.startsAt && Date.parse(promo.startsAt) > now) {
    throw new AppError('Promotion not started', ErrorCode.FORBIDDEN);
  }
  if (promo.endsAt && Date.parse(promo.endsAt) < now) {
    throw new AppError('Promotion expired', ErrorCode.FORBIDDEN);
  }
  if (
    promo.maxRedemptions !== null &&
    promo.redemptionCount >= promo.maxRedemptions
  ) {
    throw new AppError('Promotion fully redeemed', ErrorCode.CONFLICT);
  }
}

function computeDiscount(promo: Promotion, subtotalCents: number): number {
  if (subtotalCents < promo.minSubtotalCents) {
    throw new AppError('Subtotal below minimum', ErrorCode.BAD_REQUEST);
  }
  let discount = 0;
  if (promo.discountType === 'percent') {
    discount = Math.floor((subtotalCents * promo.discountValue) / 100);
  } else {
    discount = promo.discountValue;
  }
  return Math.min(discount, subtotalCents);
}

export async function validateCode(
  tenantId: string,
  actorId: string,
  code: string,
  subtotalCents: number,
): Promise<{ promotion: Promotion; discountCents: number }> {
  return runCrudOperation({
    configName: 'promotion-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const id = codeIndex.get(codeKey(tenantId, code || ''));
      if (!id) {
        throw new AppError('Invalid promotion code', ErrorCode.NOT_FOUND);
      }
      const promo = promos.get(id)!;
      if (promo.tenantId !== tenantId) {
        throw new AppError('Invalid promotion code', ErrorCode.NOT_FOUND);
      }
      assertPromoLive(promo);
      const discountCents = computeDiscount(promo, subtotalCents);
      return { promotion: promo, discountCents };
    },
    auditAction: 'data.read',
    auditResource: 'ec_promotion',
    meterEventType: 'api_call',
  });
}

export async function applyToCart(
  tenantId: string,
  actorId: string,
  input: {
    cartId: string;
    codes: string[];
    subtotalCents: number;
  },
): Promise<{ discounts: AppliedDiscount[]; totalDiscountCents: number }> {
  return runCrudOperation({
    configName: 'promotion-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('promotion-engine', ConfigSchema);
      const codes = [...new Set((input.codes || []).map((c) => c.trim().toUpperCase()).filter(Boolean))];
      if (codes.length === 0) {
        throw new AppError('codes required', ErrorCode.BAD_REQUEST);
      }
      if (codes.length > config.maxCodesPerCart) {
        throw new AppError('Too many codes for cart', ErrorCode.BAD_REQUEST);
      }

      const applied: AppliedDiscount[] = [];
      let remaining = input.subtotalCents;
      let sawNonStacking = false;

      for (const code of codes) {
        const id = codeIndex.get(codeKey(tenantId, code));
        if (!id) {
          throw new AppError('Invalid promotion code: ' + code, ErrorCode.NOT_FOUND);
        }
        const promo = promos.get(id)!;
        assertPromoLive(promo);
        if (sawNonStacking || (applied.length > 0 && promo.stackPolicy === 'none')) {
          throw new AppError('Promotion cannot stack', ErrorCode.CONFLICT);
        }
        if (promo.stackPolicy === 'none') sawNonStacking = true;
        const discountCents = computeDiscount(promo, remaining);
        applied.push({
          code: promo.code,
          promotionId: promo.id,
          discountCents,
        });
        remaining -= discountCents;
      }

      return {
        discounts: applied,
        totalDiscountCents: applied.reduce((s, d) => s + d.discountCents, 0),
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ec_promotion',
    meterEventType: 'api_call',
  });
}

export async function recordRedemption(
  tenantId: string,
  actorId: string,
  input: {
    cartId: string;
    promotionId: string;
    discountCents: number;
  },
): Promise<{ redemptionId: string }> {
  return runCrudOperation({
    configName: 'promotion-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const promo = promos.get(input.promotionId);
      if (!promo || promo.tenantId !== tenantId) {
        throw new AppError('Promotion not found', ErrorCode.NOT_FOUND);
      }
      assertPromoLive(promo);
      promo.redemptionCount += 1;
      promos.set(promo.id, promo);
      const id = crypto.randomUUID();
      redemptions.push({
        id,
        tenantId,
        promotionId: promo.id,
        cartId: input.cartId,
        discountCents: input.discountCents,
        createdAt: new Date().toISOString(),
      });
      logger.info({ code: promo.code, cartId: input.cartId }, 'Promotion redeemed');
      return { redemptionId: id };
    },
    auditAction: 'data.created',
    auditResource: 'ec_promotion_redemption',
    meterEventType: 'api_call',
  });
}
