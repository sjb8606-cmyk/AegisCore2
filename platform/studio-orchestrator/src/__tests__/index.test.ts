import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockImplementation((name: string) => {
      if (name === 'ai-generation') {
        return { enabled: true, provider: 'mock', limits: { maxPromptChars: 2000, generationsPerDay: 50 } };
      }
      if (name === 'canvas-engine') return { enabled: true, maxNodes: 500 };
      if (name === 'nocode-compiler') return { enabled: true, target: 'react' };
      return {
        enabled: true,
        reasoningProvider: 'mock',
        toolRegistry: ['generate_image', 'create_canvas', 'export_canvas', 'compile_nocode'],
        maxToolCallsPerRequest: 8,
        requireApprovalFor: [],
      };
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { __resetAiGenerationStore } from '@platform/ai-generation';
import { __resetCanvasEngineStore } from '@platform/canvas-engine';
import { __resetNocodeCompilerStore } from '@platform/nocode-compiler';
import {
  startSession,
  planSteps,
  __resetStudioOrchestratorStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-0000000000aa';

describe('studio-orchestrator', () => {
  beforeEach(() => {
    __resetStudioOrchestratorStore();
    __resetAiGenerationStore();
    __resetCanvasEngineStore();
    __resetNocodeCompilerStore();
    vi.clearAllMocks();
  });

  it('plans image step from prompt', () => {
    const steps = planSteps('make an image of a lighthouse', [
      'generate_image',
      'create_canvas',
    ]);
    expect(steps.some((s) => s.tool === 'generate_image')).toBe(true);
  });

  it('runs image session to completion', async () => {
    const session = await startSession(tenantId, userId, 'generate an image of a boat');
    expect(session.status).toBe('completed');
    expect(session.steps.length).toBeGreaterThan(0);
  });

  it('runs canvas + export path', async () => {
    const session = await startSession(
      tenantId,
      userId,
      'create a canvas design layout and export',
    );
    expect(session.status).toBe('completed');
    expect(session.steps.some((s) => s.tool === 'create_canvas')).toBe(true);
  });
});
