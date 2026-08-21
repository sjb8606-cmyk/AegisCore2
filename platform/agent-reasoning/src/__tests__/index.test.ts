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
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'risk-scoring') {
        return {
          enabled: true,
          weights: {
            cost: 0.25,
            irreversibility: 0.3,
            externalImpact: 0.2,
            dataSensitivity: 0.15,
            novelty: 0.1,
          },
          thresholds: { low: 2.0, medium: 3.0, high: 4.0 },
        };
      }
      return {
        enabled: true,
        reasoningProvider: 'mock',
        maxStepsDefault: 10,
        autoApproveBelowMedium: true,
      };
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

import { __resetRiskScoringStore } from '@platform/risk-scoring';
import {
  startRun,
  getRunSteps,
  setThinkFn,
  resolveHitl,
  getPendingHitl,
  __resetAgentReasoningStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-0000000000aa';

describe('agent-reasoning', () => {
  beforeEach(() => {
    __resetAgentReasoningStore();
    __resetRiskScoringStore();
    vi.clearAllMocks();
  });

  it('completes a simple mock run', async () => {
    const run = await startRun(tenantId, userId, {
      agentId: 'demo',
      goal: 'Summarize inbox',
    });
    expect(run.status).toBe('completed');
    const steps = await getRunSteps(tenantId, run.id);
    expect(steps.some((s) => s.phase === 'THINK')).toBe(true);
    expect(steps.some((s) => s.phase === 'CHECK')).toBe(true);
  });

  it('pauses on high risk for HITL', async () => {
    setThinkFn(async () => ({
      decision: 'place large order',
      tool: 'place_order',
      toolArgs: { amount: 10000 },
      done: false,
      riskHints: {
        cost: 5,
        irreversibility: 5,
        externalImpact: 5,
        dataSensitivity: 4,
        novelty: 3,
      },
    }));

    const run = await startRun(tenantId, userId, {
      agentId: 'demo',
      goal: 'Buy supplies',
      allowedTools: ['place_order'],
    });
    expect(run.status).toBe('waiting_hitl');
    const pending = getPendingHitl(run.id);
    expect(pending).toBeTruthy();

    const resolved = await resolveHitl(tenantId, userId, pending!.id, false);
    expect(resolved.status).toBe('cancelled');
  });

  it('blocks disallowed tools', async () => {
    setThinkFn(async () => ({
      decision: 'email someone',
      tool: 'send_email',
      toolArgs: {},
      done: true,
      riskHints: {
        cost: 1,
        irreversibility: 1,
        externalImpact: 1,
        dataSensitivity: 1,
        novelty: 1,
      },
    }));
    const run = await startRun(tenantId, userId, {
      agentId: 'demo',
      goal: 'Email',
      allowedTools: ['noop'],
      maxSteps: 3,
    });
    const steps = await getRunSteps(tenantId, run.id);
    expect(steps.some((s) => s.phase === 'VALIDATE' && s.blocked)).toBe(true);
  });
});
