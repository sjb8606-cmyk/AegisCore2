import { randomUUID } from 'crypto';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { linkEvent, GENESIS_HASH, ChainedEvent, AuditEvent } from '@platform/audit';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { MerkleManglerBot } from '../redteam/merkle-mangler';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-02',
    role: 'Test Merkle Mangler used to verify forgery detection against the real chain algorithm.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Merkle Mangler used to verify naive tamper detection and the consistent-reforge finding.',
    permissionScope: ['redteam:attack-merkle-chain'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function baseEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: randomUUID(),
    tenantId: 'tenant-a',
    actorId: 'test-actor',
    actorType: 'service',
    action: 'data.read',
    outcome: 'success',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function buildValidChain(count: number): ChainedEvent[] {
  const chain: ChainedEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < count; i++) {
    const chained = linkEvent(baseEvent({ id: `event-${i}` }), prevHash, i);
    chain.push(chained);
    prevHash = chained._hash;
  }
  return chain;
}

describe('MerkleManglerBot', () => {
  describe('attemptNaiveTamper', () => {
    it('is detected by the real verifyChain() algorithm — defense working correctly', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(5);

      const result = await bot.attemptNaiveTamper(chain, 2, { outcome: 'failure' });

      expect(result.forgeryDetected).toBe(true);
      expect(result.chainReportedValid).toBe(false);
    });

    it('never mutates the caller\'s original chain', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(5);
      const originalOutcome = chain[2].outcome;

      await bot.attemptNaiveTamper(chain, 2, { outcome: 'failure' });

      expect(chain[2].outcome).toBe(originalOutcome);
    });
  });

  describe('attemptConsistentReforge', () => {
    it('succeeds undetected — the genuine finding this bot exists to surface', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(5);

      const result = await bot.attemptConsistentReforge(chain, 2, { outcome: 'failure' });

      expect(result.forgeryDetected).toBe(false);
      expect(result.chainReportedValid).toBe(true);
    });

    it('never mutates the caller\'s original chain', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(5);
      const originalOutcome = chain[2].outcome;
      const originalHash = chain[2]._hash;

      await bot.attemptConsistentReforge(chain, 2, { outcome: 'failure' });

      expect(chain[2].outcome).toBe(originalOutcome);
      expect(chain[2]._hash).toBe(originalHash);
    });

    it('works when tampering the first event in the chain (genesis edge case)', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(3);

      const result = await bot.attemptConsistentReforge(chain, 0, { outcome: 'failure' });

      expect(result.forgeryDetected).toBe(false);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(3);
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptNaiveTamper(chain, 1, { outcome: 'failure' });

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new MerkleManglerBot(makeSpec());
      const chain = buildValidChain(3);
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptNaiveTamper(chain, 1, { outcome: 'failure' });

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-merkle-chain permission', async () => {
      const bot = new MerkleManglerBot(makeSpec({ permissionScope: [] }));
      const chain = buildValidChain(3);

      await expect(bot.attemptNaiveTamper(chain, 1, { outcome: 'failure' })).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
