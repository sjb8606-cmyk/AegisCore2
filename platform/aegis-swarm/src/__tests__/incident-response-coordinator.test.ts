vi.mock('../lib/incident-store', () => ({
  openIncident: vi.fn(),
  appendTimelineEvent: vi.fn(),
  updateIncidentStatus: vi.fn(),
  getIncident: vi.fn(),
}));

import { swarmSignalBus } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';
import {
  openIncident,
  appendTimelineEvent,
  updateIncidentStatus,
  getIncident,
} from '../lib/incident-store';
import { IncidentResponseCoordinatorBot } from '../bots/incident-response-coordinator';

function makeSpec(overrides: Partial<BotSpecification> = {}): BotSpecification {
  return {
    version: '1.0',
    proposedBotId: 'D-14',
    role: 'Test Incident Response Coordinator used to verify lifecycle guards and playbook lookup.',
    triggerConditions: ['manual'],
    behaviorDescription:
      'Test-only Incident Response Coordinator used to verify open/append/status transitions and the honest notification stub.',
    permissionScope: ['write:incidents', 'read:incidents', 'read:playbooks'],
    hitlClassification: 'Alert',
    ancestry: { sourceSignals: ['test'], adversarialFingerprintMatch: false },
    ...overrides,
  };
}

const SAMPLE_INCIDENT = {
  id: 'incident-1',
  tenantId: 'tenant-a',
  category: 'secrets_exposure',
  description: 'AWS key found in a commit',
  status: 'open' as const,
  timeline: [{ type: 'opened', detail: 'AWS key found in a commit', timestamp: new Date().toISOString() }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('IncidentResponseCoordinatorBot', () => {
  const mockOpenIncident = openIncident as vi.Mock;
  const mockAppendTimelineEvent = appendTimelineEvent as vi.Mock;
  const mockUpdateIncidentStatus = updateIncidentStatus as vi.Mock;
  const mockGetIncident = getIncident as vi.Mock;

  beforeEach(() => {
    mockOpenIncident.mockReset();
    mockAppendTimelineEvent.mockReset();
    mockUpdateIncidentStatus.mockReset();
    mockGetIncident.mockReset();
  });

  describe('openIncident', () => {
    it('opens an incident and returns a real decisionId', async () => {
      mockOpenIncident.mockResolvedValue(SAMPLE_INCIDENT);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());

      const result = await bot.openIncident('tenant-a', 'secrets_exposure', 'AWS key found in a commit');

      expect(result.id).toBe('incident-1');
      expect(typeof result.decisionId).toBe('string');
    });

    it('signals the swarm when an incident is opened', async () => {
      mockOpenIncident.mockResolvedValue(SAMPLE_INCIDENT);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.openIncident('tenant-a', 'secrets_exposure', 'desc');

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('blocks opening without write:incidents permission', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec({ permissionScope: ['read:incidents'] }));
      await expect(bot.openIncident('tenant-a', 'secrets_exposure', 'desc')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('appendTimelineEvent', () => {
    it('reports success from the store', async () => {
      mockAppendTimelineEvent.mockResolvedValue(true);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const result = await bot.appendTimelineEvent('tenant-a', 'incident-1', 'note', 'checked access logs');
      expect(result.appended).toBe(true);
    });

    it('blocks appending without write:incidents permission', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec({ permissionScope: ['read:incidents'] }));
      await expect(
        bot.appendTimelineEvent('tenant-a', 'incident-1', 'note', 'x'),
      ).rejects.toThrow('outside its declared permissionScope');
    });
  });

  describe('updateIncidentStatus', () => {
    it('signals the swarm only when the transition to resolved actually succeeds', async () => {
      mockUpdateIncidentStatus.mockResolvedValue(true);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      const result = await bot.updateIncidentStatus('tenant-a', 'incident-1', 'resolved');

      expect(result.updated).toBe(true);
      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('does not signal when transitioning to investigating (not resolved)', async () => {
      mockUpdateIncidentStatus.mockResolvedValue(true);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      await bot.updateIncidentStatus('tenant-a', 'incident-1', 'investigating');

      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('does not signal when the guarded transition fails', async () => {
      mockUpdateIncidentStatus.mockResolvedValue(false);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const received: unknown[] = [];
      const unsubscribe = swarmSignalBus.subscribe((s) => received.push(s));

      const result = await bot.updateIncidentStatus('tenant-a', 'incident-1', 'resolved');

      expect(result.updated).toBe(false);
      expect(received).toHaveLength(0);
      unsubscribe();
    });

    it('blocks status updates without write:incidents permission', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec({ permissionScope: ['read:incidents'] }));
      await expect(bot.updateIncidentStatus('tenant-a', 'incident-1', 'resolved')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('getIncidentStatus', () => {
    it('returns the current incident state', async () => {
      mockGetIncident.mockResolvedValue(SAMPLE_INCIDENT);
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const result = await bot.getIncidentStatus('tenant-a', 'incident-1');
      expect(result?.status).toBe('open');
    });

    it('blocks lookup without read:incidents permission', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec({ permissionScope: ['write:incidents'] }));
      await expect(bot.getIncidentStatus('tenant-a', 'incident-1')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('matchPlaybook', () => {
    it('returns real playbook steps for a known category', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const steps = await bot.matchPlaybook('secrets_exposure');
      expect(steps).not.toBeNull();
      expect(steps!.length).toBeGreaterThan(0);
    });

    it('returns null for an unknown category rather than inventing steps', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      const steps = await bot.matchPlaybook('some_category_that_does_not_exist');
      expect(steps).toBeNull();
    });

    it('blocks playbook lookup without read:playbooks permission', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec({ permissionScope: ['write:incidents'] }));
      await expect(bot.matchPlaybook('secrets_exposure')).rejects.toThrow(
        'outside its declared permissionScope',
      );
    });
  });

  describe('notifyResponders', () => {
    it('throws an honest error rather than faking a notification', async () => {
      const bot = new IncidentResponseCoordinatorBot(makeSpec());
      await expect(bot.notifyResponders('incident-1', 'slack')).rejects.toThrow(
        'no configured notification channel',
      );
    });
  });
});
