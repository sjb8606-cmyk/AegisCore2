/**
 * platform/agent-memory
 *
 * Goal + step-history persistence across sessions.
 * Called from agent-reasoning REMEMBER phase.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('agent-memory');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  persistAcrossSessions: z.boolean().default(true),
  maxStepsStored: z.number().int().positive().default(200),
});

export type AgentMemoryConfig = z.infer<typeof ConfigSchema>;

export type GoalStatus = 'active' | 'completed' | 'abandoned';

export interface AgentGoal {
  runId: string;
  tenantId: string;
  goalText: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemoryStep {
  id: string;
  runId: string;
  tenantId: string;
  stepNumber: number;
  decision: Record<string, unknown>;
  result: Record<string, unknown> | null;
  blocked: boolean;
  rejected: boolean;
  createdAt: string;
}

const goals = new Map<string, AgentGoal>(); // runId
const steps = new Map<string, AgentMemoryStep[]>(); // runId

export function __resetAgentMemoryStore(): void {
  goals.clear();
  steps.clear();
}

async function loadCfg(): Promise<AgentMemoryConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('agent-memory', ConfigSchema);
}

export async function upsertGoal(
  tenantId: string,
  actorId: string,
  input: { runId: string; goalText: string; status?: GoalStatus },
): Promise<AgentGoal> {
  return runCrudOperation({
    configName: 'agent-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.runId || !input.goalText?.trim()) {
        throw new AppError('runId and goalText required', ErrorCode.BAD_REQUEST);
      }
      const existing = goals.get(input.runId);
      const now = new Date().toISOString();
      const goal: AgentGoal = {
        runId: input.runId,
        tenantId,
        goalText: input.goalText.trim(),
        status: input.status || existing?.status || 'active',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      goals.set(input.runId, goal);
      return goal;
    },
    auditAction: 'data.created',
    auditResource: 'agent_goal',
    meterEventType: 'api_call',
  });
}

export async function appendStep(
  tenantId: string,
  actorId: string,
  input: {
    runId: string;
    stepNumber: number;
    decision: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    blocked?: boolean;
    rejected?: boolean;
  },
): Promise<AgentMemoryStep> {
  return runCrudOperation({
    configName: 'agent-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.runId) {
        throw new AppError('runId is required', ErrorCode.BAD_REQUEST);
      }

      const list = steps.get(input.runId) || [];
      const step: AgentMemoryStep = {
        id: crypto.randomUUID(),
        runId: input.runId,
        tenantId,
        stepNumber: input.stepNumber,
        decision: input.decision || {},
        result: input.result ?? null,
        blocked: input.blocked ?? false,
        rejected: input.rejected ?? false,
        createdAt: new Date().toISOString(),
      };
      list.push(step);
      // Cap storage
      while (list.length > config.maxStepsStored) list.shift();
      steps.set(input.runId, list);
      logger.debug({ runId: input.runId, step: input.stepNumber }, 'Memory step stored');
      return step;
    },
    auditAction: 'data.created',
    auditResource: 'agent_memory_step',
    meterEventType: 'api_call',
  });
}

export async function getAgentMemory(
  tenantId: string,
  runId: string,
): Promise<{ goal: AgentGoal | null; steps: AgentMemoryStep[] }> {
  const goal = goals.get(runId);
  if (goal && goal.tenantId !== tenantId) {
    return { goal: null, steps: [] };
  }
  const list = (steps.get(runId) || []).filter((s) => s.tenantId === tenantId);
  return {
    goal: goal && goal.tenantId === tenantId ? goal : null,
    steps: list,
  };
}

export async function setGoalStatus(
  tenantId: string,
  actorId: string,
  runId: string,
  status: GoalStatus,
): Promise<AgentGoal> {
  return runCrudOperation({
    configName: 'agent-memory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const goal = goals.get(runId);
      if (!goal || goal.tenantId !== tenantId) {
        throw new AppError('Goal not found', ErrorCode.NOT_FOUND);
      }
      goal.status = status;
      goal.updatedAt = new Date().toISOString();
      goals.set(runId, goal);
      return goal;
    },
    auditAction: 'data.updated',
    auditResource: 'agent_goal',
    meterEventType: 'api_call',
  });
}

/** Adapter for agent-reasoning setRememberFn */
export function rememberFnAdapter(tenantId: string, actorId: string) {
  return async (
    run: { id: string; goal: string },
    step: {
      step: number;
      decision: string | null;
      result: unknown;
      blocked: boolean;
      rejected: boolean;
    },
  ) => {
    await upsertGoal(tenantId, actorId, {
      runId: run.id,
      goalText: run.goal,
    });
    await appendStep(tenantId, actorId, {
      runId: run.id,
      stepNumber: step.step,
      decision: { text: step.decision },
      result:
        step.result && typeof step.result === 'object'
          ? (step.result as Record<string, unknown>)
          : { value: step.result },
      blocked: step.blocked,
      rejected: step.rejected,
    });
  };
}
