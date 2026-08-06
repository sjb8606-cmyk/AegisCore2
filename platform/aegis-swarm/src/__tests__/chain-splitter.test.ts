import { randomUUID } from 'crypto';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { linkEvent, GENESIS_HASH, ChainedEvent, AuditEvent } from '@platform/audit';
import { redTeamSignalBus } from '../redteam/redteam-isolation';
import { ChainSplitterBot } from '../redteam/chain-splitter';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'R-07',
    role: 'Test Chain Splitter used to verify gap injection and fork detection against the real algorithm.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Chain Splitter used to verify gap detection and the fork-undetected finding.',
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

describe('ChainSplitterBot', () => {
  describe('attemptGapInjection', () => {
    it('is detected by the real verifyChain() algorithm — defense working correctly', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);

      const result = await bot.attemptGapInjection(chain, 3);

      expect(result.gapDetected).toBe(true);
    });

    it('never mutates the caller\'s original chain', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);
      const originalLength = chain.length;

      await bot.attemptGapInjection(chain, 3);

      expect(chain).toHaveLength(originalLength);
    });
  });

  describe('attemptFork', () => {
    it('succeeds: both branches independently report as fully valid', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);

      const forkedContent = [{ outcome: 'failure' as const }, { outcome: 'failure' as const }];
      const result = await bot.attemptFork(chain, 3, forkedContent);

      expect(result.originalBranchValid).toBe(true);
      expect(result.forkedBranchValid).toBe(true);
      expect(result.forkSucceeded).toBe(true);
    });

    it('confirms both branches genuinely share the fork-point hash', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);

      const result = await bot.attemptFork(chain, 3, [{ outcome: 'failure' as const }, { outcome: 'failure' as const }]);

      expect(result.branchesShareForkPointHash).toBe(true);
    });

    it('confirms the two branch tips genuinely differ (a real fork exists)', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);

      const result = await bot.attemptFork(chain, 3, [{ outcome: 'failure' as const }, { outcome: 'failure' as const }]);

      expect(result.branchTipsDiffer).toBe(true);
    });

    it('never mutates the caller\'s original chain', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(6);
      const originalTipHash = chain[5]._hash;

      await bot.attemptFork(chain, 3, [{ outcome: 'failure' as const }, { outcome: 'failure' as const }]);

      expect(chain[5]._hash).toBe(originalTipHash);
      expect(chain).toHaveLength(6);
    });
  });

  describe('isolation', () => {
    it('never signals the real production swarmSignalBus', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(4);
      const productionReceived: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => productionReceived.push(s));

      await bot.attemptGapInjection(chain, 2);

      expect(productionReceived).toHaveLength(0);
      unsubscribe();
    });

    it('signals the isolated redTeamSignalBus instead', async () => {
      const bot = new ChainSplitterBot(makeSpec());
      const chain = buildValidChain(4);
      const redTeamReceived: unknown[] = [];
      const unsubscribe = redTeamSignalBus.subscribe((s) => redTeamReceived.push(s));

      await bot.attemptGapInjection(chain, 2);

      expect(redTeamReceived).toHaveLength(1);
      unsubscribe();
    });
  });

  describe('permission enforcement', () => {
    it('blocks attacks without redteam:attack-merkle-chain permission', async () => {
      const bot = new ChainSplitterBot(makeSpec({ permissionScope: [] }));
      const chain = buildValidChain(4);

      await expect(bot.attemptGapInjection(chain, 1)).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
