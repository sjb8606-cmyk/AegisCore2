import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ThreatIntelAggregatorBot } from '../bots/threat-intel-aggregator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-05',
    role: 'Test threat intel aggregator used to verify STIX/MISP normalization.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only threat intel aggregator used to verify STIX pattern parsing, MISP attribute normalization, and the honest TAXII stub.',
    permissionScope: ['process:threat-intel'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('ThreatIntelAggregatorBot', () => {
  describe('normalizeStixBundle', () => {
    it('normalizes a simple ipv4-addr indicator', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = {
        objects: [
          {
            id: 'indicator--001',
            type: 'indicator',
            pattern: "[ipv4-addr:value = '198.51.100.1']",
            valid_from: '2026-01-01T00:00:00Z',
            confidence: 85,
            labels: ['malicious-activity'],
          },
        ],
      };

      const report = await bot.normalizeStixBundle(bundle);

      expect(report.parsedCount).toBe(1);
      expect(report.skippedCount).toBe(0);
      expect(report.indicators[0]).toMatchObject({
        source: 'stix',
        indicatorType: 'ipv4-addr',
        value: '198.51.100.1',
        confidence: 85,
        tags: ['malicious-activity'],
      });
    });

    it('normalizes a domain-name indicator', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = {
        objects: [
          { id: 'indicator--002', type: 'indicator', pattern: "[domain-name:value = 'evil.example.com']" },
        ],
      };

      const report = await bot.normalizeStixBundle(bundle);
      expect(report.indicators[0].indicatorType).toBe('domain-name');
      expect(report.indicators[0].value).toBe('evil.example.com');
    });

    it('skips a compound/boolean pattern rather than guessing at it', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = {
        objects: [
          {
            id: 'indicator--003',
            type: 'indicator',
            pattern: "[ipv4-addr:value = '1.2.3.4'] AND [domain-name:value = 'evil.com']",
          },
        ],
      };

      const report = await bot.normalizeStixBundle(bundle);

      expect(report.parsedCount).toBe(0);
      expect(report.skippedCount).toBe(1);
      expect(report.skippedIds).toContain('indicator--003');
    });

    it('ignores non-indicator STIX objects (e.g. malware, threat-actor)', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = {
        objects: [
          { id: 'malware--001', type: 'malware' } as any,
          { id: 'indicator--004', type: 'indicator', pattern: "[url:value = 'http://bad.example']" },
        ],
      };

      const report = await bot.normalizeStixBundle(bundle);
      expect(report.parsedCount).toBe(1);
      expect(report.indicators[0].rawId).toBe('indicator--004');
    });

    it('signals the swarm when indicators are found', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = { objects: [{ id: 'i-1', type: 'indicator', pattern: "[ipv4-addr:value = '1.1.1.1']" }] };
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.normalizeStixBundle(bundle);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when nothing was parsed', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const bundle = { objects: [{ id: 'i-1', type: 'indicator', pattern: 'garbage-not-a-pattern' }] };
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.normalizeStixBundle(bundle);

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks normalization without process:threat-intel permission', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.normalizeStixBundle({ objects: [] })).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('normalizeMispEvent', () => {
    it('normalizes a well-formed MISP attribute', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const event = {
        Event: {
          Attribute: [
            { uuid: 'attr-1', type: 'ip-dst', value: '203.0.113.5', category: 'Network activity', timestamp: '1700000000' },
          ],
        },
      };

      const report = await bot.normalizeMispEvent(event);

      expect(report.parsedCount).toBe(1);
      expect(report.indicators[0]).toMatchObject({
        source: 'misp',
        indicatorType: 'ip-dst',
        value: '203.0.113.5',
        tags: ['Network activity'],
      });
      expect(report.indicators[0].firstSeen).toBe(new Date(1700000000 * 1000).toISOString());
    });

    it('skips an attribute missing a value', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const event = { Event: { Attribute: [{ uuid: 'attr-2', type: 'ip-dst' }] } };

      const report = await bot.normalizeMispEvent(event);

      expect(report.parsedCount).toBe(0);
      expect(report.skippedCount).toBe(1);
      expect(report.skippedIds).toContain('attr-2');
    });

    it('handles an event with no attributes at all', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      const report = await bot.normalizeMispEvent({ Event: {} });
      expect(report.parsedCount).toBe(0);
      expect(report.skippedCount).toBe(0);
    });

    it('blocks normalization without process:threat-intel permission', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec({ permissionScope: [] }));
      await expect(bot.normalizeMispEvent({ Event: { Attribute: [] } })).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('fetchTaxiiCollection', () => {
    it('throws an honest error rather than faking a network fetch', async () => {
      const bot = new ThreatIntelAggregatorBot(makeSpec());
      await expect(bot.fetchTaxiiCollection('https://example-taxii.test', 'collection-1')).rejects.toThrow(
        'no TAXII 2.x client',
      );
    });
  });
});
