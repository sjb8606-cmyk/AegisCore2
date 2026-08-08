/**
 * platform/aegis-swarm/src/employees/grant-funding-advisor.ts
 *
 * E-06 — Grant & Funding Advisor.
 *
 * Honest note, unlike the last five employees: there's no single
 * historical "master" whose method cleanly maps onto grant matching
 * the way Pacioli maps to bookkeeping or Eisenhower maps to
 * prioritization — forcing an attribution here would be exactly the
 * kind of fabrication this whole build has been avoiding. What's
 * real and buildable instead: genuine multi-criteria eligibility
 * matching, checking a company's real profile against a program's
 * real requirements and reporting every failing criterion, not just
 * the first — verified against real match/mismatch cases before
 * implementation.
 *
 * Also reuses the same "urgent" concept from E-02 (a deadline within
 * a real threshold) for flagging time-sensitive applications, rather
 * than reimplementing a second urgency notion.
 *
 * No LLM call needed — real, deterministic multi-criteria matching.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const URGENT_DEADLINE_THRESHOLD_DAYS = 14;

export interface GrantProgram {
  name: string;
  minCompanyAgeMonths: number | null;
  maxCompanyAgeMonths: number | null;
  eligibleSectors: string[];
  eligibleRegions: string[];
  minFundingAmount: number | null;
  maxFundingAmount: number;
  applicationDeadlineDaysAway: number | null;
  requiresIncorporation: boolean;
}

export interface CompanyProfile {
  ageMonths: number;
  sector: string;
  region: string;
  isIncorporated: boolean;
  requestedAmount: number;
}

export interface EligibilityResult {
  programName: string;
  eligible: boolean;
  reasons: string[];
  urgent: boolean;
}

export function checkEligibility(company: CompanyProfile, program: GrantProgram): EligibilityResult {
  const reasons: string[] = [];

  if (program.minCompanyAgeMonths !== null && company.ageMonths < program.minCompanyAgeMonths) {
    reasons.push(`Company age ${company.ageMonths}mo is below minimum ${program.minCompanyAgeMonths}mo`);
  }
  if (program.maxCompanyAgeMonths !== null && company.ageMonths > program.maxCompanyAgeMonths) {
    reasons.push(`Company age ${company.ageMonths}mo exceeds maximum ${program.maxCompanyAgeMonths}mo`);
  }
  if (program.eligibleSectors.length > 0 && !program.eligibleSectors.includes(company.sector)) {
    reasons.push(`Sector "${company.sector}" not in eligible list: ${program.eligibleSectors.join(', ')}`);
  }
  if (program.eligibleRegions.length > 0 && !program.eligibleRegions.includes(company.region)) {
    reasons.push(`Region "${company.region}" not in eligible list: ${program.eligibleRegions.join(', ')}`);
  }
  if (program.requiresIncorporation && !company.isIncorporated) {
    reasons.push('Program requires incorporation, company is not incorporated');
  }
  if (company.requestedAmount > program.maxFundingAmount) {
    reasons.push(`Requested $${company.requestedAmount} exceeds program max $${program.maxFundingAmount}`);
  }
  if (program.minFundingAmount !== null && company.requestedAmount < program.minFundingAmount) {
    reasons.push(`Requested $${company.requestedAmount} below program min $${program.minFundingAmount}`);
  }

  const urgent =
    program.applicationDeadlineDaysAway !== null &&
    program.applicationDeadlineDaysAway <= URGENT_DEADLINE_THRESHOLD_DAYS;

  return { programName: program.name, eligible: reasons.length === 0, reasons, urgent };
}

export interface MatchReport {
  eligiblePrograms: EligibilityResult[];
  ineligiblePrograms: EligibilityResult[];
  urgentEligibleCount: number;
}

export class GrantFundingAdvisorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async matchPrograms(company: CompanyProfile, programs: GrantProgram[]): Promise<MatchReport> {
    await this.enforcePermission('read:grant-programs');

    const results = programs.map((p) => checkEligibility(company, p));
    const eligiblePrograms = results.filter((r) => r.eligible);
    const ineligiblePrograms = results.filter((r) => !r.eligible);
    const urgentEligibleCount = eligiblePrograms.filter((r) => r.urgent).length;

    const report: MatchReport = { eligiblePrograms, ineligiblePrograms, urgentEligibleCount };

    await this.createDecision(
      { company, programCount: programs.length },
      { eligibleCount: eligiblePrograms.length, urgentEligibleCount },
      'grant-funding-advisor-v1',
    );

    if (urgentEligibleCount > 0) {
      await this.signalSwarm('employee.urgent_eligible_grant_found', {
        botId: this.botId,
        urgentEligibleCount,
      });
    }

    return report;
  }
}
