import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { GrantFundingAdvisorBot, checkEligibility, CompanyProfile, GrantProgram } from '../employees/grant-funding-advisor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'E-06',
    role: 'Test Grant Funding Advisor used to verify eligibility matching.',
    triggerConditions: ['manual'],
    behaviorDescription: 'Test-only Grant Funding Advisor used to verify real multi-criteria matching.',
    permissionScope: ['read:grant-programs'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const COMPANY: CompanyProfile = {
  ageMonths: 8,
  sector: 'technology',
  region: 'New Brunswick',
  isIncorporated: true,
  requestedAmount: 25000,
};

function program(overrides: Partial<GrantProgram> = {}): GrantProgram {
  return {
    name: 'NB Innovation Grant',
    minCompanyAgeMonths: 0,
    maxCompanyAgeMonths: 60,
    eligibleSectors: ['technology'],
    eligibleRegions: ['New Brunswick'],
    minFundingAmount: 5000,
    maxFundingAmount: 50000,
    applicationDeadlineDaysAway: null,
    requiresIncorporation: true,
    ...overrides,
  };
}

describe('checkEligibility (pure multi-criteria matching)', () => {
  it('confirms a genuine match with no failing criteria', () => {
    const result = checkEligibility(COMPANY, program());
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('reports every failing criterion, not just the first', () => {
    const result = checkEligibility(
      COMPANY,
      program({ minCompanyAgeMonths: 24, eligibleSectors: ['manufacturing'], eligibleRegions: ['Ontario'] }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });

  it('flags a requested amount above the program max', () => {
    const result = checkEligibility(COMPANY, program({ maxFundingAmount: 10000 }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('exceeds program max');
  });

  it('flags a requested amount below the program min', () => {
    const result = checkEligibility(COMPANY, program({ minFundingAmount: 30000 }));
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain('below program min');
  });

  it('flags an unincorporated company against an incorporation-required program', () => {
    const result = checkEligibility({ ...COMPANY, isIncorporated: false }, program({ requiresIncorporation: true }));
    expect(result.eligible).toBe(false);
  });

  it('flags a real program as urgent when the deadline is within 14 days', () => {
    const result = checkEligibility(COMPANY, program({ applicationDeadlineDaysAway: 5 }));
    expect(result.urgent).toBe(true);
  });

  it('does not flag a distant deadline as urgent', () => {
    const result = checkEligibility(COMPANY, program({ applicationDeadlineDaysAway: 60 }));
    expect(result.urgent).toBe(false);
  });
});

describe('GrantFundingAdvisorBot', () => {
  describe('matchPrograms', () => {
    it('sorts programs into eligible and ineligible correctly', async () => {
      const bot = new GrantFundingAdvisorBot(makeSpec());
      const report = await bot.matchPrograms(COMPANY, [
        program({ name: 'Good Match' }),
        program({ name: 'Bad Match', eligibleRegions: ['Ontario'] }),
      ]);

      expect(report.eligiblePrograms.map((p) => p.programName)).toEqual(['Good Match']);
      expect(report.ineligiblePrograms.map((p) => p.programName)).toEqual(['Bad Match']);
    });

    it('counts urgent eligible programs correctly', async () => {
      const bot = new GrantFundingAdvisorBot(makeSpec());
      const report = await bot.matchPrograms(COMPANY, [
        program({ name: 'Urgent Match', applicationDeadlineDaysAway: 5 }),
        program({ name: 'Non-Urgent Match', applicationDeadlineDaysAway: 60 }),
      ]);

      expect(report.urgentEligibleCount).toBe(1);
    });

    it('signals the swarm when an urgent eligible program exists', async () => {
      const bot = new GrantFundingAdvisorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.matchPrograms(COMPANY, [program({ applicationDeadlineDaysAway: 5 })]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when nothing urgent is eligible', async () => {
      const bot = new GrantFundingAdvisorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.matchPrograms(COMPANY, [program({ applicationDeadlineDaysAway: 60 })]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks matching without read:grant-programs permission', async () => {
      const bot = new GrantFundingAdvisorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.matchPrograms(COMPANY, [])).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
