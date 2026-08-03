import { randomUUID } from 'crypto';
import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { linkEvent, GENESIS_HASH, ChainedEvent, AuditEvent } from '@platform/audit';
import { VeridactAuditorBot } from '../bots/veridact-auditor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-03',
    role: 'Test Veridact Auditor used to verify the real verifyChain() wrapper.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Veridact Auditor used to verify chain-break detection against real linked events.',
    permissionScope: ['read:audit-chain'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

function baseEvent(tenantId: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: randomUUID(),
    tenantId,
    actorId: 'test-actor',
    actorType: 'service',
    action: 'data.read',
    outcome: 'success',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function buildValidChain(tenantId: string, count: number): ChainedEvent[] {
  const chain: ChainedEvent[] = [];
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < count; i++) {
    const event = baseEvent(tenantId, { id: `event-${i}` });
    const chained = linkEvent(event, prevHash, i);
    chain.push(chained);
    prevHash = chained._hash;
  }

  return chain;
}

describe('VeridactAuditorBot', () => {
  describe('verifyChainIntegrity', () => {
    it('reports a valid chain as valid, with zero findings', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 5);

      const report = await bot.verifyChainIntegrity(chain);

      expect(report.valid).toBe(true);
      expect(report.findings).toHaveLength(0);
      expect(report.checked).toBe(5);
    });

    it('detects a tampered event (hash no longer matches content)', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 3);

      chain[1] = { ...chain[1], outcome: 'failure' };

      const report = await bot.verifyChainIntegrity(chain);

      expect(report.valid).toBe(false);
      expect(report.findings.length).toBeGreaterThan(0);
      expect(report.findings[0].sev).toBe('block');
      expect(report.findings.some((f) => f.desc.includes('tampered'))).toBe(true);
    });

    it('detects a broken prevHash link', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 3);

      chain[2] = { ...chain[2], _prevHash: 'deliberately-wrong-hash' };

      const report = await bot.verifyChainIntegrity(chain);

      expect(report.valid).toBe(false);
      expect(report.findings.some((f) => f.desc.includes('_prevHash mismatch'))).toBe(true);
    });

    it('detects a sequence gap', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 3);

      chain[2] = { ...chain[2], _sequence: 99 };

      const report = await bot.verifyChainIntegrity(chain);

      expect(report.valid).toBe(false);
      expect(report.findings.some((f) => f.desc.includes('sequence gap'))).toBe(true);
    });

    it('returns valid for an empty chain (nothing to break)', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const report = await bot.verifyChainIntegrity([]);

      expect(report.valid).toBe(true);
      expect(report.checked).toBe(0);
    });

    it('blocks verification without read:audit-chain permission', async () => {
      const bot = new VeridactAuditorBot(makeSpec({ permissionScope: [] }));
      const chain = buildValidChain('tenant-a', 2);
      await expect(bot.verifyChainIntegrity(chain)).rejects.toThrow('outside its declared permissionScope');
    });

    it('signals the swarm when a chain break is found', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 3);
      chain[1] = { ...chain[1], outcome: 'failure' };

      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.verifyChainIntegrity(chain);

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal the swarm for a valid chain', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      const chain = buildValidChain('tenant-a', 3);

      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((signal) => received.push(signal));

      await bot.verifyChainIntegrity(chain);

      expect(received).toHaveLength(0);
      unsubscribe();
    });
  });

  describe('fetchAndVerifyTenantChain', () => {
    it('throws an honest error rather than faking a fetch', async () => {
      const bot = new VeridactAuditorBot(makeSpec());
      await expect(bot.fetchAndVerifyTenantChain('tenant-a')).rejects.toThrow(
        'no function to list/fetch',
      );
    });
  });
});
