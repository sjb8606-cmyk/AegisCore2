import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { ThreatHuntCoordinatorBot } from '../bots/threat-hunt-coordinator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-21',
    role: 'Test Threat Hunt Coordinator used to verify hypothesis lifecycle guards.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Threat Hunt Coordinator used to verify hypothesis open/evidence/resolve guarding.',
    permissionScope: ['write:threat-hunts', 'read:threat-hunts'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

describe('ThreatHuntCoordinatorBot', () => {
  describe('openHypothesis', () => {
    it('opens a hypothesis with real, relevant bot IDs for a known category', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('active_exfiltration', 'Possible slow exfil via D-15-monitored channel');

      expect(hypothesis).not.toBeNull();
      expect(hypothesis!.relevantBotIds).toEqual(['D-15', 'D-18']);
      expect(hypothesis!.status).toBe('open');
    });

    it('returns null for an unknown category rather than guessing', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('made_up_category', 'statement');
      expect(hypothesis).toBeNull();
    });

    it('signals the swarm when a hypothesis is opened', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.openHypothesis('audit_tampering', 'statement');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks opening without write:threat-hunts permission', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec({ permissionScope: ['read:threat-hunts'] }));
      await expect(bot.openHypothesis('audit_tampering', 'x')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('recordEvidence', () => {
    it('records evidence against an open hypothesis', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('audit_tampering', 'statement');

      const recorded = await bot.recordEvidence(hypothesis!.id, 'D-03', 2);
      expect(recorded).toBe(true);

      const fetched = await bot.getHypothesis(hypothesis!.id);
      expect(fetched!.evidence).toHaveLength(1);
    });

    it('refuses to record evidence for a nonexistent hypothesis', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const recorded = await bot.recordEvidence('nonexistent-id', 'D-03', 1);
      expect(recorded).toBe(false);
    });
  });

  describe('resolveHypothesis', () => {
    it('resolves an open hypothesis to confirmed', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('audit_tampering', 'statement');

      const resolved = await bot.resolveHypothesis(hypothesis!.id, 'confirmed');
      expect(resolved).toBe(true);

      const fetched = await bot.getHypothesis(hypothesis!.id);
      expect(fetched!.status).toBe('confirmed');
    });

    it('refuses to re-resolve an already-resolved hypothesis', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('audit_tampering', 'statement');
      await bot.resolveHypothesis(hypothesis!.id, 'confirmed');

      const secondAttempt = await bot.resolveHypothesis(hypothesis!.id, 'refuted');
      expect(secondAttempt).toBe(false);

      const fetched = await bot.getHypothesis(hypothesis!.id);
      expect(fetched!.status).toBe('confirmed');
    });

    it('signals the swarm only when resolved to confirmed', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec());
      const hypothesis = await bot.openHypothesis('audit_tampering', 'statement');

      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.resolveHypothesis(hypothesis!.id, 'refuted');
      expect(received).toHaveLength(0);

      unsubscribe();
    });
  });

  describe('getHypothesis', () => {
    it('blocks lookup without read:threat-hunts permission', async () => {
      const bot = new ThreatHuntCoordinatorBot(makeSpec({ permissionScope: ['write:threat-hunts'] }));
      await expect(bot.getHypothesis('any-id')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
