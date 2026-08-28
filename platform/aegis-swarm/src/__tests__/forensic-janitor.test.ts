vi.mock('../lib/purge-store', () => ({
  requestPurge: vi.fn(),
  cancelPurge: vi.fn(),
  executePurge: vi.fn(),
  getPurge: vi.fn(),
}));

import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import { requestPurge, cancelPurge, executePurge, getPurge } from '../lib/purge-store';
import { ForensicJanitorBot } from '../bots/forensic-janitor';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-12',
    role: 'Test Forensic Janitor used to verify the 24h purge time-lock.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Forensic Janitor used to verify request/cancel/execute guarding and separation of duties.',
    permissionScope: ['write:purge-requests', 'execute:purge', 'read:purge-requests'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const SAMPLE_PURGE = {
  id: 'purge-1',
  tenantId: 'tenant-a',
  dataScope: 'user:12345 activity logs',
  authorizedBy: 'ciso-shawn',
  unlocksAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  status: 'pending' as const,
  receiptId: null,
  createdAt: new Date().toISOString(),
  decidedAt: null,
};

describe('ForensicJanitorBot', () => {
  const mockRequestPurge = requestPurge as vi.Mock;
  const mockCancelPurge = cancelPurge as vi.Mock;
  const mockExecutePurge = executePurge as vi.Mock;
  const mockGetPurge = getPurge as vi.Mock;

  beforeEach(() => {
    mockRequestPurge.mockReset();
    mockCancelPurge.mockReset();
    mockExecutePurge.mockReset();
    mockGetPurge.mockReset();
  });

  describe('requestPurge', () => {
    it('opens a purge and returns a real decisionId', async () => {
      mockRequestPurge.mockResolvedValue(SAMPLE_PURGE);
      const bot = new ForensicJanitorBot(makeSpec());

      const result = await bot.requestPurge('tenant-a', 'user:12345 activity logs', 'ciso-shawn');

      expect(result.id).toBe('purge-1');
      expect(typeof result.decisionId).toBe('string');
      expect(mockRequestPurge).toHaveBeenCalledWith('tenant-a', 'user:12345 activity logs', 'ciso-shawn');
    });

    it('signals the swarm when a purge is requested', async () => {
      mockRequestPurge.mockResolvedValue(SAMPLE_PURGE);
      const bot = new ForensicJanitorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.requestPurge('tenant-a', 'scope', 'ciso-shawn');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks requesting without write:purge-requests permission', async () => {
      const bot = new ForensicJanitorBot(makeSpec({ permissionScope: ['execute:purge'] }));
      await expect(bot.requestPurge('tenant-a', 'scope', 'ciso-shawn')).rejects.toThrow(
        'outside its declared permissionScope',
      );
      expect(mockRequestPurge).not.toHaveBeenCalled();
    });
  });

  describe('cancelPurge', () => {
    it('reports success when the store confirms cancellation', async () => {
      mockCancelPurge.mockResolvedValue(true);
      const bot = new ForensicJanitorBot(makeSpec());

      const result = await bot.cancelPurge('tenant-a', 'purge-1');
      expect(result.cancelled).toBe(true);
    });

    it('reports failure without throwing when the guard rejects it (already executed or past window)', async () => {
      mockCancelPurge.mockResolvedValue(false);
      const bot = new ForensicJanitorBot(makeSpec());

      const result = await bot.cancelPurge('tenant-a', 'purge-1');
      expect(result.cancelled).toBe(false);
    });

    it('blocks cancelling without write:purge-requests permission', async () => {
      const bot = new ForensicJanitorBot(makeSpec({ permissionScope: ['execute:purge'] }));
      await expect(bot.cancelPurge('tenant-a', 'purge-1')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('executePurge', () => {
    it('reports success and signals the swarm when the time-lock has genuinely expired', async () => {
      mockExecutePurge.mockResolvedValue(true);
      const bot = new ForensicJanitorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      const result = await bot.executePurge('tenant-a', 'purge-1');

      expect(result.executed).toBe(true);
      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('reports failure without signaling when the guard rejects it (still within window)', async () => {
      mockExecutePurge.mockResolvedValue(false);
      const bot = new ForensicJanitorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      const result = await bot.executePurge('tenant-a', 'purge-1');

      expect(result.executed).toBe(false);
      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('requires the separate execute:purge scope — write:purge-requests alone is not enough', async () => {
      const bot = new ForensicJanitorBot(makeSpec({ permissionScope: ['write:purge-requests'] }));
      await expect(bot.executePurge('tenant-a', 'purge-1')).rejects.toThrow(
        'outside its declared permissionScope',
      );
      expect(mockExecutePurge).not.toHaveBeenCalled();
    });
  });

  describe('getPurgeStatus', () => {
    it('returns the current purge state', async () => {
      mockGetPurge.mockResolvedValue(SAMPLE_PURGE);
      const bot = new ForensicJanitorBot(makeSpec());

      const result = await bot.getPurgeStatus('tenant-a', 'purge-1');
      expect(result?.status).toBe('pending');
    });

    it('blocks lookup without read:purge-requests permission', async () => {
      const bot = new ForensicJanitorBot(makeSpec({ permissionScope: ['write:purge-requests'] }));
      await expect(bot.getPurgeStatus('tenant-a', 'purge-1')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });
});
