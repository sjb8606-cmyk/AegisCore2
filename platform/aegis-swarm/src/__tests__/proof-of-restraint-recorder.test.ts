jest.mock('../lib/restraint-store', () => ({
  recordRefusal: jest.fn(),
  listRefusals: jest.fn(),
}));

import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { recordRefusal, listRefusals } from '../lib/restraint-store';
import { ProofOfRestraintRecorderBot } from '../bots/proof-of-restraint-recorder';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-22',
    role: 'Test Proof-of-Restraint Recorder used to verify the immutable ledger.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Proof-of-Restraint Recorder used to verify recordRefusal()/listRefusals() and unconditional signaling.',
    permissionScope: ['write:restraint-ledger', 'read:restraint-ledger'],
    hitlClassification: 'Logging',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const SAMPLE_RECORD = {
  id: 'restraint-1',
  tenantId: 'tenant-a',
  botId: 'D-06',
  actionBlocked: 'exec:npm-audit-fix',
  refusalReason: 'outside its declared permissionScope',
  inputContext: {},
  receiptId: null,
  createdAt: new Date().toISOString(),
};

describe('ProofOfRestraintRecorderBot', () => {
  const mockRecordRefusal = recordRefusal as jest.Mock;
  const mockListRefusals = listRefusals as jest.Mock;

  beforeEach(() => {
    mockRecordRefusal.mockReset();
    mockListRefusals.mockReset();
  });

  describe('recordRefusal', () => {
    it('records a refusal and returns a real decisionId', async () => {
      mockRecordRefusal.mockResolvedValue(SAMPLE_RECORD);
      const bot = new ProofOfRestraintRecorderBot(makeSpec());

      const result = await bot.recordRefusal(
        'tenant-a',
        'D-06',
        'exec:npm-audit-fix',
        'outside its declared permissionScope',
      );

      expect(result.id).toBe('restraint-1');
      expect(typeof result.decisionId).toBe('string');
    });

    it('always signals the swarm on a successful record — never conditional', async () => {
      mockRecordRefusal.mockResolvedValue(SAMPLE_RECORD);
      const bot = new ProofOfRestraintRecorderBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.recordRefusal('tenant-a', 'D-06', 'exec:npm-audit-fix', 'reason');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks recording without write:restraint-ledger permission', async () => {
      const bot = new ProofOfRestraintRecorderBot(makeSpec({ permissionScope: ['read:restraint-ledger'] }));
      await expect(
        bot.recordRefusal('tenant-a', 'D-06', 'action', 'reason'),
      ).rejects.toThrow('outside its declared permissionScope');
      expect(mockRecordRefusal).not.toHaveBeenCalled();
    });
  });

  describe('listRefusals', () => {
    it('returns the tenant restraint ledger', async () => {
      mockListRefusals.mockResolvedValue([SAMPLE_RECORD]);
      const bot = new ProofOfRestraintRecorderBot(makeSpec());

      const results = await bot.listRefusals('tenant-a');
      expect(results).toHaveLength(1);
      expect(results[0].botId).toBe('D-06');
    });

    it('blocks reading without read:restraint-ledger permission', async () => {
      const bot = new ProofOfRestraintRecorderBot(makeSpec({ permissionScope: ['write:restraint-ledger'] }));
      await expect(bot.listRefusals('tenant-a')).rejects.toThrow('outside its declared permissionScope');
    });
  });
});
