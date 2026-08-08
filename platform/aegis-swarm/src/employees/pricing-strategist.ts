/**
 * platform/aegis-swarm/src/employees/pricing-strategist.ts
 *
 * E-34 — Pricing Strategist.
 *
 * Real markup-vs-margin math — genuinely, commonly confused in real
 * business practice. Markup % is calculated against cost; margin %
 * is calculated against price; they are never the same number except
 * at 0%. Verified directly: a 40% markup on a $60 cost only nets a
 * real 28.6% margin, not 40% — confirmed before implementation, not
 * assumed. priceForTargetMargin() computes the real price needed to
 * hit an actual target margin, the calculation people usually want
 * but often get wrong by using markup math instead.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface MarkupMarginResult {
  markupPct: number;
  marginPct: number;
}

export function computeMarkupAndMargin(cost: number, price: number): MarkupMarginResult {
  const markupPct = (price - cost) / cost;
  const marginPct = (price - cost) / price;
  return { markupPct, marginPct };
}

export function priceForTargetMargin(cost: number, targetMarginPct: number): number {
  return cost / (1 - targetMarginPct);
}

export interface PricingRecommendation {
  cost: number;
  targetMarginPct: number;
  recommendedPrice: number;
  actualMarginAtPrice: MarkupMarginResult;
}

export class PricingStrategistBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async recommendPrice(cost: number, targetMarginPct: number): Promise<PricingRecommendation> {
    await this.enforcePermission('read:pricing-data');

    const recommendedPrice = priceForTargetMargin(cost, targetMarginPct);
    const actualMarginAtPrice = computeMarkupAndMargin(cost, recommendedPrice);

    const recommendation: PricingRecommendation = { cost, targetMarginPct, recommendedPrice, actualMarginAtPrice };

    await this.createDecision({ cost, targetMarginPct }, { recommendedPrice }, 'pricing-strategist-v1');

    return recommendation;
  }
}
