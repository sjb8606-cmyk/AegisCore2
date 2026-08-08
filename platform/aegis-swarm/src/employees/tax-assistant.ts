/**
 * platform/aegis-swarm/src/employees/tax-assistant.ts
 *
 * E-12 — Tax Assistant.
 *
 * Real progressive marginal tax calculation — genuine, standard math,
 * verified against three real cases (single bracket, two-bracket
 * span, three-bracket span) before implementation. Bracket data is
 * always a real input, never hardcoded — actual tax rates change and
 * vary by jurisdiction, and this bot never pretends to know the
 * current real numbers. It computes correctly against whatever real
 * brackets are supplied.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface TaxBracket {
  threshold: number;
  rate: number;
}

export function computeMarginalTax(income: number, brackets: TaxBracket[]): number {
  let tax = 0;
  const sorted = [...brackets].sort((a, b) => a.threshold - b.threshold);

  for (let i = 0; i < sorted.length; i++) {
    const lower = sorted[i].threshold;
    const upper = i + 1 < sorted.length ? sorted[i + 1].threshold : Infinity;
    if (income > lower) {
      const amountInBracket = Math.min(income, upper) - lower;
      if (amountInBracket > 0) tax += amountInBracket * sorted[i].rate;
    }
  }

  return tax;
}

export interface TaxSummary {
  income: number;
  taxOwed: number;
  effectiveRate: number;
}

export class TaxAssistantBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async calculateTax(income: number, brackets: TaxBracket[]): Promise<TaxSummary> {
    await this.enforcePermission('read:tax-data');

    const taxOwed = computeMarginalTax(income, brackets);
    const effectiveRate = income > 0 ? taxOwed / income : 0;
    const summary: TaxSummary = { income, taxOwed, effectiveRate };

    await this.createDecision({ income, bracketCount: brackets.length }, { taxOwed, effectiveRate }, 'tax-assistant-v1');

    return summary;
  }
}
