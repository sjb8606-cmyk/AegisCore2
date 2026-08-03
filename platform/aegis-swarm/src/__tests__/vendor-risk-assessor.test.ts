import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ThreatIndicator } from '../bots/threat-intel-aggregator';
import { VendorRiskAssessorBot } from '../bots/vendor-risk-assessor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-19',
    role: 'Test Vendor Risk Assessor used to verify indicator matching and scoring.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Vendor Risk Assessor used to verify D-05 ThreatIndicator composition and transparent scoring.',
    permissionScope: ['read:vendor-risk-data'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function makeIndicator(value: string, overrides: Partial<ThreatIndicator> = {}): ThreatIndicator {
  return { source: 'stix', indicatorType: 'domain-name', value, tags: [], rawId: `indicator-${value}`, ...overrides };
}

describe('VendorRiskAssessorBot', () => {
  describe('assessVendor', () => {
    it('reports zero risk when no infrastructure matches', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const report = await bot.assessVendor(
        'CleanVendor Inc',
        ['clean-vendor.example.com'],
        [makeIndicator('evil.example.com')],
      );

      expect(report.riskScore).toBe(0);
      expect(report.matchedIndicators).toHaveLength(0);
    });

    it('matches a vendor domain to a real threat indicator, case-insensitively', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const report = await bot.assessVendor(
        'SketchyVendor',
        ['Vendor-API.Example.Com'],
        [makeIndicator('vendor-api.example.com')],
      );

      expect(report.matchedIndicators).toHaveLength(1);
      expect(report.riskScore).toBe(25);
    });

    it('caps risk score at 100 regardless of how many indicators match', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const infra = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
      const indicators = infra.map((v) => makeIndicator(v));

      const report = await bot.assessVendor('BadVendor', infra, indicators);

      expect(report.matchedIndicators).toHaveLength(5);
      expect(report.riskScore).toBe(100);
    });

    it('does not match a similar but different domain', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const report = await bot.assessVendor(
        'AlmostVendor',
        ['vendor-api.example.com'],
        [makeIndicator('vendor-api.example.org')],
      );

      expect(report.matchedIndicators).toHaveLength(0);
    });

    it('produces a finding with a clear description for each match', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const report = await bot.assessVendor('SketchyVendor', ['bad.example.com'], [makeIndicator('bad.example.com')]);

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].desc).toContain('SketchyVendor');
      expect(report.findings[0].sev).toBe('crit');
    });

    it('blocks assessment without read:vendor-risk-data permission', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.assessVendor('V', ['x.com'], [])).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when a match is found', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.assessVendor('SketchyVendor', ['bad.example.com'], [makeIndicator('bad.example.com')]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when there is no match', async () => {
      const bot = new VendorRiskAssessorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.assessVendor('CleanVendor', ['clean.example.com'], [makeIndicator('bad.example.com')]);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });
});
