import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      missionTypes: {
        standard: {
          phases: [
            {
              name: 'Recon',
              allowedTools: ['web_search', 'noop'],
              completionCriteria: 'context_gathered',
            },
            {
              name: 'Execute',
              allowedTools: ['send_email', 'noop'],
              completionCriteria: 'actions_done',
            },
          ],
        },
      },
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  startMission,
  getMissionStatus,
  advancePhase,
  getAllowedToolsForRun,
  __resetMissionPhaseStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const runId = 'run-mission-1';

describe('mission-phase', () => {
  beforeEach(() => {
    __resetMissionPhaseStore();
    vi.clearAllMocks();
  });

  it('starts in Recon with limited tools', async () => {
    await startMission(tenantId, actorId, { runId, missionType: 'standard' });
    const status = await getMissionStatus(tenantId, runId);
    expect(status?.currentPhase.name).toBe('Recon');
    expect(status?.allowedTools).toContain('web_search');
    expect(status?.allowedTools).not.toContain('send_email');
  });

  it('advance unlocks Execute tools', async () => {
    await startMission(tenantId, actorId, { runId });
    await advancePhase(tenantId, actorId, runId, {
      satisfiedCriteria: 'context_gathered',
    });
    expect(getAllowedToolsForRun(runId)).toContain('send_email');
    const status = await getMissionStatus(tenantId, runId);
    expect(status?.currentPhase.name).toBe('Execute');
  });

  it('rejects unknown mission type', async () => {
    try {
      await startMission(tenantId, actorId, {
        runId: 'x',
        missionType: 'nope',
      });
      expect.fail('should throw');
    } catch (err: any) {
      expect(String(err?.message ?? err)).toMatch(/unknown|mission/i);
    }
  });
});
