import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { DataExfiltrationSentinelBot } from '../bots/data-exfiltration-sentinel';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-15',
    role: 'Test Data Exfiltration Sentinel used to verify allowlist + reused z-score composition.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Data Exfiltration Sentinel used to verify destination allowlisting and volume anomaly detection via D-07 reuse.',
    permissionScope: ['read:outbound-flows'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const ALLOWLIST = ['api.stripe.com', 'cdn.example.com'];
const NORMAL_VOLUME_BASELINE = [1000, 1200, 950, 1100, 1050];

describe('DataExfiltrationSentinelBot', () => {
  describe('monitorOutboundFlows', () => {
    it('does not flag a normal-volume flow to a known destination', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows(
        [{ destination: 'api.stripe.com', bytesTransferred: 1080 }],
        NORMAL_VOLUME_BASELINE,
      );

      expect(report.findings).toHaveLength(0);
    });

    it('flags a flow to a non-allowlisted destination regardless of (small) volume', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows([
        { destination: 'evil.example.net', bytesTransferred: 50 },
      ]);

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].sev).toBe('block');
      expect(report.findings[0].desc).toContain('non-allowlisted');
    });

    it('flags an unusually large transfer to a known destination via reused z-score logic', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows(
        [{ destination: 'api.stripe.com', bytesTransferred: 500_000 }],
        NORMAL_VOLUME_BASELINE,
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].sev).toBe('crit');
      expect(report.findings[0].desc).toContain('Unusually large');
    });

    it('does not double-flag a non-allowlisted destination with a huge volume', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows(
        [{ destination: 'evil.example.net', bytesTransferred: 500_000 }],
        NORMAL_VOLUME_BASELINE,
      );

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].desc).toContain('non-allowlisted');
    });

    it('skips volume checking entirely when no baseline is supplied', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows([
        { destination: 'api.stripe.com', bytesTransferred: 999_999_999 },
      ]);

      expect(report.findings).toHaveLength(0);
    });

    it('checks multiple flows independently', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const report = await bot.monitorOutboundFlows(
        [
          { destination: 'api.stripe.com', bytesTransferred: 1050 },
          { destination: 'evil.example.net', bytesTransferred: 100 },
          { destination: 'cdn.example.com', bytesTransferred: 500_000 },
        ],
        NORMAL_VOLUME_BASELINE,
      );

      expect(report.flowsChecked).toBe(3);
      expect(report.findings).toHaveLength(2);
    });

    it('blocks monitoring without read:outbound-flows permission', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec({ permissionScope: [] }), ALLOWLIST);
      await expect(
        bot.monitorOutboundFlows([{ destination: 'api.stripe.com', bytesTransferred: 100 }]),
      ).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when a suspicious flow is found', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.monitorOutboundFlows([{ destination: 'evil.example.net', bytesTransferred: 50 }]);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm when all flows are clean', async () => {
      const bot = new DataExfiltrationSentinelBot(makeSpec(), ALLOWLIST);
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.monitorOutboundFlows(
        [{ destination: 'api.stripe.com', bytesTransferred: 1050 }],
        NORMAL_VOLUME_BASELINE,
      );

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });
});
