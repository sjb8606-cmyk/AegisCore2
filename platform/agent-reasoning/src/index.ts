/**
 * platform/agent-reasoning
 *
 * 10-phase agent loop:
 * OBSERVE → CONSTRAIN → THINK → VALIDATE → RISK → HITL → ACT → AUDIT → REMEMBER → CHECK
 *
 * Default THINK is mock (no LLM required for unit tests).
 * Tool execution, memory, mission phase are injectable hooks.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { scoreDecision } from '@platform/risk-scoring';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('agent-reasoning');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reasoningProvider: z
    .enum(['mock', 'groq', 'anthropic', 'openai'])
    .default('mock'),
  maxStepsDefault: z.number().int().positive().default(20),
  autoApproveBelowMedium: z.boolean().default(true),
});

export type AgentReasoningConfig = z.infer<typeof ConfigSchema>;

export type RunStatus =
  | 'running'
  | 'waiting_hitl'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentStepRecord {
  step: number;
  phase: string;
  decision: string | null;
  tool: string | null;
  result: unknown;
  blocked: boolean;
  rejected: boolean;
  riskScore: number | null;
  createdAt: string;
}

export interface HitlApproval {
  id: string;
  runId: string;
  step: number;
  decision: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}

export interface AgentRun {
  id: string;
  tenantId: string;
  agentId: string;
  goal: string;
  status: RunStatus;
  currentStep: number;
  maxSteps: number;
  missionPhase: string | null;
  budgetUsedUsd: number;
  steps: AgentStepRecord[];
  allowedTools: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface ThinkResult {
  decision: string;
  tool: string | null;
  toolArgs?: Record<string, unknown>;
  done?: boolean;
  riskHints?: {
    cost: number;
    irreversibility: number;
    externalImpact: number;
    dataSensitivity: number;
    novelty: number;
  };
}

export type ThinkFn = (ctx: {
  goal: string;
  steps: AgentStepRecord[];
  allowedTools: string[];
}) => Promise<ThinkResult>;

export type ToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type RememberFn = (
  run: AgentRun,
  step: AgentStepRecord,
) => Promise<void>;

const runs = new Map<string, AgentRun>();
const hitl = new Map<string, HitlApproval>();

let thinkFn: ThinkFn = async ({ goal, steps }) => {
  if (steps.length >= 1) {
    return { decision: 'goal accomplished (mock)', tool: null, done: true };
  }
  return {
    decision: `acknowledge goal: ${goal.slice(0, 80)}`,
    tool: 'noop',
    toolArgs: {},
    done: false,
    riskHints: {
      cost: 1,
      irreversibility: 1,
      externalImpact: 1,
      dataSensitivity: 1,
      novelty: 1,
    },
  };
};

let toolFn: ToolFn = async (name) => ({ ok: true, tool: name });
let rememberFn: RememberFn = async () => {};

export function setThinkFn(fn: ThinkFn): void {
  thinkFn = fn;
}
export function setToolFn(fn: ToolFn): void {
  toolFn = fn;
}
export function setRememberFn(fn: RememberFn): void {
  rememberFn = fn;
}

export function __resetAgentReasoningStore(): void {
  runs.clear();
  hitl.clear();
  thinkFn = async ({ goal, steps }) => {
    if (steps.length >= 1) {
      return { decision: 'goal accomplished (mock)', tool: null, done: true };
    }
    return {
      decision: `acknowledge goal: ${goal.slice(0, 80)}`,
      tool: 'noop',
      toolArgs: {},
      done: false,
      riskHints: {
        cost: 1,
        irreversibility: 1,
        externalImpact: 1,
        dataSensitivity: 1,
        novelty: 1,
      },
    };
  };
  toolFn = async (name) => ({ ok: true, tool: name });
  rememberFn = async () => {};
}

async function loadCfg(): Promise<AgentReasoningConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('agent-reasoning', ConfigSchema);
}

function pushStep(run: AgentRun, partial: Partial<AgentStepRecord> & { phase: string }): AgentStepRecord {
  const rec: AgentStepRecord = {
    step: run.currentStep,
    phase: partial.phase,
    decision: partial.decision ?? null,
    tool: partial.tool ?? null,
    result: partial.result ?? null,
    blocked: partial.blocked ?? false,
    rejected: partial.rejected ?? false,
    riskScore: partial.riskScore ?? null,
    createdAt: new Date().toISOString(),
  };
  run.steps.push(rec);
  return rec;
}

export async function startRun(
  tenantId: string,
  userId: string,
  input: {
    agentId: string;
    goal: string;
    maxSteps?: number;
    allowedTools?: string[];
    missionPhase?: string;
  },
): Promise<AgentRun> {
  return runCrudOperation({
    configName: 'agent-reasoning',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const config = await loadCfg();
      if (!input.goal?.trim()) {
        throw new AppError('goal is required', ErrorCode.BAD_REQUEST);
      }
      const run: AgentRun = {
        id: crypto.randomUUID(),
        tenantId,
        agentId: input.agentId || 'default',
        goal: input.goal.trim(),
        status: 'running',
        currentStep: 0,
        maxSteps: input.maxSteps || config.maxStepsDefault,
        missionPhase: input.missionPhase || 'execute',
        budgetUsedUsd: 0,
        steps: [],
        allowedTools: input.allowedTools || ['noop', 'web_search'],
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      runs.set(run.id, run);
      logger.info({ runId: run.id, goal: run.goal }, 'Agent run started');
      return advanceRun(tenantId, userId, run.id);
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'agent_run',
    meterEventType: 'api_call',
  });
}

/**
 * Drive the loop until HITL wait, complete, fail, or max steps.
 */
export async function advanceRun(
  tenantId: string,
  userId: string,
  runId: string,
): Promise<AgentRun> {
  const run = runs.get(runId);
  if (!run || run.tenantId !== tenantId) {
    throw new AppError('Run not found', ErrorCode.NOT_FOUND);
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return run;
  }
  if (run.status === 'waiting_hitl') {
    return run;
  }

  const config = await loadCfg();

  while (run.status === 'running' && run.currentStep < run.maxSteps) {
    run.currentStep += 1;

    // 1. OBSERVE
    pushStep(run, {
      phase: 'OBSERVE',
      decision: `goal=\( {run.goal}; priorSteps= \){run.steps.length}`,
    });

    // 2. CONSTRAIN — allowedTools already scoped by mission
    pushStep(run, {
      phase: 'CONSTRAIN',
      decision: `allowedTools=${run.allowedTools.join(',')}`,
    });

    // 3. THINK
    const thought = await thinkFn({
      goal: run.goal,
      steps: run.steps,
      allowedTools: run.allowedTools,
    });
    pushStep(run, {
      phase: 'THINK',
      decision: thought.decision,
      tool: thought.tool,
    });

    if (thought.done && !thought.tool) {
      pushStep(run, { phase: 'CHECK', decision: 'complete' });
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      break;
    }

    // 4. VALIDATE — tool must be allowed
    if (thought.tool && !run.allowedTools.includes(thought.tool)) {
      const blocked = pushStep(run, {
        phase: 'VALIDATE',
        decision: thought.decision,
        tool: thought.tool,
        blocked: true,
        result: 'tool not allowed',
      });
      await rememberFn(run, blocked);
      continue;
    }
    pushStep(run, {
      phase: 'VALIDATE',
      decision: 'ok',
      tool: thought.tool,
    });

    // 5. RISK
    const hints = thought.riskHints || {
      cost: thought.tool ? 2 : 1,
      irreversibility: thought.tool === 'place_order' ? 4 : 1,
      externalImpact: thought.tool ? 2 : 0,
      dataSensitivity: 1,
      novelty: run.currentStep === 1 ? 2 : 1,
    };
    const risk = await scoreDecision(tenantId, userId, {
      runId: run.id,
      step: run.currentStep,
      decision: thought.decision,
      ...hints,
    });
    pushStep(run, {
      phase: 'RISK',
      decision: thought.decision,
      riskScore: risk.score,
      result: { label: risk.label, gateFired: risk.gateFired },
    });

    // 6. HITL
    if (risk.gateFired) {
      const approval: HitlApproval = {
        id: crypto.randomUUID(),
        runId: run.id,
        step: run.currentStep,
        decision: thought.decision,
        status: 'pending',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      hitl.set(approval.id, approval);
      pushStep(run, {
        phase: 'HITL',
        decision: thought.decision,
        result: { approvalId: approval.id, status: 'pending' },
      });
      run.status = 'waiting_hitl';
      runs.set(run.id, run);
      return run;
    }
    pushStep(run, { phase: 'HITL', decision: 'auto-approved' });

    // 7. ACT
    let actResult: unknown = null;
    if (thought.tool) {
      actResult = await toolFn(thought.tool, thought.toolArgs || {});
      run.budgetUsedUsd += 0.001;
    }
    const actStep = pushStep(run, {
      phase: 'ACT',
      decision: thought.decision,
      tool: thought.tool,
      result: actResult,
    });

    // 8. AUDIT (recorded via steps + risk score already)
    pushStep(run, {
      phase: 'AUDIT',
      decision: thought.decision,
      result: { audited: true },
    });

    // 9. REMEMBER
    await rememberFn(run, actStep);
    pushStep(run, { phase: 'REMEMBER', decision: 'stored' });

    // 10. CHECK
    if (thought.done) {
      pushStep(run, { phase: 'CHECK', decision: 'complete' });
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      break;
    }
    pushStep(run, { phase: 'CHECK', decision: 'continue' });
  }

  if (run.status === 'running' && run.currentStep >= run.maxSteps) {
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    pushStep(run, { phase: 'CHECK', decision: 'max_steps_reached' });
  }

  runs.set(run.id, run);
  return run;
}

export async function resolveHitl(
  tenantId: string,
  userId: string,
  approvalId: string,
  approve: boolean,
): Promise<AgentRun> {
  return runCrudOperation({
    configName: 'agent-reasoning',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const approval = hitl.get(approvalId);
      if (!approval) throw new AppError('Approval not found', ErrorCode.NOT_FOUND);
      const run = runs.get(approval.runId);
      if (!run || run.tenantId !== tenantId) {
        throw new AppError('Run not found', ErrorCode.NOT_FOUND);
      }
      if (approval.status !== 'pending') {
        throw new AppError('Approval already resolved', ErrorCode.CONFLICT);
      }

      approval.status = approve ? 'approved' : 'rejected';
      approval.resolvedAt = new Date().toISOString();
      hitl.set(approvalId, approval);

      if (!approve) {
        pushStep(run, {
          phase: 'HITL',
          decision: approval.decision,
          rejected: true,
          result: { approvalId, status: 'rejected' },
        });
        run.status = 'cancelled';
        run.completedAt = new Date().toISOString();
        runs.set(run.id, run);
        return run;
      }

      run.status = 'running';
      // Execute the deferred ACT for the approved decision (simplified: continue loop)
      runs.set(run.id, run);
      return advanceRun(tenantId, userId, run.id);
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hitl_approval',
    meterEventType: 'api_call',
  });
}

export async function getRun(
  tenantId: string,
  runId: string,
): Promise<AgentRun | null> {
  const r = runs.get(runId);
  if (!r || r.tenantId !== tenantId) return null;
  return r;
}

export async function getRunSteps(
  tenantId: string,
  runId: string,
): Promise<AgentStepRecord[]> {
  const r = await getRun(tenantId, runId);
  if (!r) throw new AppError('Run not found', ErrorCode.NOT_FOUND);
  return r.steps;
}

export function getPendingHitl(runId: string): HitlApproval | null {
  for (const a of hitl.values()) {
    if (a.runId === runId && a.status === 'pending') return a;
  }
  return null;
}
