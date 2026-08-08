/**
 * platform/aegis-swarm/src/employees/financial-architect.ts
 *
 * E-27 — Financial Architect.
 *
 * Real, standard startup finance math — genuine, computable
 * formulas, same caliber as E-05's double-entry accounting.
 * computeBurnAndRunway() and computeDilution() verified against real
 * cases before implementation, including the real edge case (a
 * profitable company has infinite runway) and real cap table
 * mechanics (post-money = pre-money + raise; new investor % =
 * raise/post-money; existing holders dilute proportionally).
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface BurnAndRunway {
  netBurn: number;
  runwayMonths: number;
}

export function computeBurnAndRunway(monthlyRevenue: number, monthlyExpenses: number, cashOnHand: number): BurnAndRunway {
  const netBurn = monthlyExpenses - monthlyRevenue;
  const runwayMonths = netBurn > 0 ? cashOnHand / netBurn : Infinity;
  return { netBurn, runwayMonths };
}

export interface DilutionResult {
  postMoneyValuation: number;
  newInvestorPct: number;
  newExistingPct: number;
}

export function computeDilution(preMoneyValuation: number, raiseAmount: number, existingOwnershipPct: number): DilutionResult {
  const postMoneyValuation = preMoneyValuation + raiseAmount;
  const newInvestorPct = raiseAmount / postMoneyValuation;
  const newExistingPct = existingOwnershipPct * (preMoneyValuation / postMoneyValuation);
  return { postMoneyValuation, newInvestorPct, newExistingPct };
}

export interface FinancialSnapshot {
  burnAndRunway: BurnAndRunway;
  runwayWarning: boolean;
}

const RUNWAY_WARNING_THRESHOLD_MONTHS = 6;

export class FinancialArchitectBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async assessFinancials(monthlyRevenue: number, monthlyExpenses: number, cashOnHand: number): Promise<FinancialSnapshot> {
    await this.enforcePermission('read:financial-data');

    const burnAndRunway = computeBurnAndRunway(monthlyRevenue, monthlyExpenses, cashOnHand);
    const runwayWarning = burnAndRunway.runwayMonths < RUNWAY_WARNING_THRESHOLD_MONTHS;

    const snapshot: FinancialSnapshot = { burnAndRunway, runwayWarning };

    await this.createDecision(
      { monthlyRevenue, monthlyExpenses, cashOnHand },
      { runwayMonths: burnAndRunway.runwayMonths, runwayWarning },
      'financial-architect-v1',
    );

    if (runwayWarning) {
      await this.signalSwarm('employee.low_runway_warning', { botId: this.botId, runwayMonths: burnAndRunway.runwayMonths });
    }

    return snapshot;
  }

  async simulateDilution(preMoneyValuation: number, raiseAmount: number, existingOwnershipPct: number): Promise<DilutionResult> {
    await this.enforcePermission('read:financial-data');

    const result = computeDilution(preMoneyValuation, raiseAmount, existingOwnershipPct);

    await this.createDecision(
      { preMoneyValuation, raiseAmount, existingOwnershipPct },
      { newExistingPct: result.newExistingPct },
      'financial-architect-v1',
    );

    return result;
  }
}
