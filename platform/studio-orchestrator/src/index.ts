/**
 * platform/studio-orchestrator — prompt → tool steps across studio cores.
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { generateImage } from '@platform/ai-generation';
import { createDocument, exportDocument } from '@platform/canvas-engine';
import { saveApp, compileApp } from '@platform/nocode-compiler';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
const logger = getLogger('studio-orchestrator');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reasoningProvider: z.enum(['mock', 'groq', 'openai']).default('mock'),
  toolRegistry: z
    .array(z.string())
    .default(['generate_image', 'create_canvas', 'export_canvas', 'compile_nocode']),
  maxToolCallsPerRequest: z.number().default(8),
  requireApprovalFor: z.array(z.string()).default([]),
});

export interface OrchestratorStep {
  stepNumber: number;
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  status: 'pending' | 'done' | 'failed' | 'awaiting_approval';
}

export interface OrchestratorSession {
  id: string;
  tenantId: string;
  userId: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'awaiting_approval';
  steps: OrchestratorStep[];
  createdAt: string;
}

const sessions = new Map<string, OrchestratorSession>();

export function __resetStudioOrchestratorStore(): void {
  sessions.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('studio-orchestrator', ConfigSchema);
}

export function planSteps(
  prompt: string,
  registry: string[],
): { tool: string; input: Record<string, unknown> }[] {
  const p = prompt.toLowerCase();
  const steps: { tool: string; input: Record<string, unknown> }[] = [];
  if (p.includes('image') || p.includes('picture') || p.includes('logo')) {
    if (registry.includes('generate_image')) {
      steps.push({ tool: 'generate_image', input: { prompt } });
    }
  }
  if (p.includes('canvas') || p.includes('design') || p.includes('layout')) {
    if (registry.includes('create_canvas')) {
      steps.push({ tool: 'create_canvas', input: { name: 'Studio Board' } });
    }
    if (registry.includes('export_canvas')) {
      steps.push({ tool: 'export_canvas', input: { format: 'png' } });
    }
  }
  if (p.includes('app') || p.includes('nocode') || p.includes('page')) {
    if (registry.includes('compile_nocode')) {
      steps.push({
        tool: 'compile_nocode',
        input: { name: 'Studio App', definition: { title: prompt.slice(0, 40) } },
      });
    }
  }
  if (!steps.length && registry.includes('generate_image')) {
    steps.push({ tool: 'generate_image', input: { prompt } });
  }
  return steps;
}

async function executeTool(
  tenantId: string,
  userId: string,
  tool: string,
  input: Record<string, unknown>,
  ctx: { lastCanvasId?: string },
): Promise<unknown> {
  switch (tool) {
    case 'generate_image':
      return generateImage(tenantId, userId, String(input.prompt || ''));
    case 'create_canvas': {
      const doc = await createDocument(tenantId, userId, {
        name: String(input.name || 'Board'),
      });
      ctx.lastCanvasId = doc.id;
      return doc;
    }
    case 'export_canvas': {
      if (!ctx.lastCanvasId) throw new AppError('No canvas to export', ErrorCode.BAD_REQUEST);
      return exportDocument(
        tenantId,
        userId,
        ctx.lastCanvasId,
        (input.format as 'png' | 'svg' | 'json') || 'png',
      );
    }
    case 'compile_nocode': {
      const app = await saveApp(tenantId, userId, {
        name: String(input.name || 'App'),
        definition: (input.definition as Record<string, unknown>) || {},
      });
      return compileApp(tenantId, userId, app.id);
    }
    default:
      throw new AppError(`Unknown tool: ${tool}`, ErrorCode.BAD_REQUEST);
  }
}

export async function startSession(
  tenantId: string,
  userId: string,
  prompt: string,
): Promise<OrchestratorSession> {
  return runCrudOperation({
    configName: 'studio-orchestrator',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const config = await loadCfg();
      if (!prompt?.trim()) throw new AppError('prompt is required', ErrorCode.BAD_REQUEST);

      const planned = planSteps(prompt, config.toolRegistry).slice(
        0,
        config.maxToolCallsPerRequest,
      );
      const session: OrchestratorSession = {
        id: crypto.randomUUID(),
        tenantId,
        userId,
        prompt: prompt.trim(),
        status: 'running',
        steps: [],
        createdAt: new Date().toISOString(),
      };

      const ctx: { lastCanvasId?: string } = {};
      for (let i = 0; i < planned.length; i++) {
        const p = planned[i];
        const step: OrchestratorStep = {
          stepNumber: i + 1,
          tool: p.tool,
          input: p.input,
          output: null,
          status: 'pending',
        };
        if (config.requireApprovalFor.includes(p.tool)) {
          step.status = 'awaiting_approval';
          session.steps.push(step);
          session.status = 'awaiting_approval';
          sessions.set(session.id, session);
          return session;
        }
        try {
          step.output = await executeTool(tenantId, userId, p.tool, p.input, ctx);
          step.status = 'done';
        } catch (err: any) {
          step.output = { error: String(err?.message || err) };
          step.status = 'failed';
          session.steps.push(step);
          session.status = 'failed';
          sessions.set(session.id, session);
          return session;
        }
        session.steps.push(step);
      }
      session.status = 'completed';
      sessions.set(session.id, session);
      logger.info({ sessionId: session.id, steps: session.steps.length }, 'Studio session done');
      return session;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'studio_session',
    meterEventType: 'api_call',
  });
}

export async function getSession(
  tenantId: string,
  sessionId: string,
): Promise<OrchestratorSession | null> {
  const s = sessions.get(sessionId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}

export async function approveStep(
  tenantId: string,
  userId: string,
  sessionId: string,
  stepNumber: number,
): Promise<OrchestratorSession> {
  return runCrudOperation({
    configName: 'studio-orchestrator',
    configSchema: ConfigSchema,
    tenantId,
    actorId: userId,
    action: async () => {
      const session = sessions.get(sessionId);
      if (!session || session.tenantId !== tenantId) {
        throw new AppError('Session not found', ErrorCode.NOT_FOUND);
      }
      const step = session.steps.find((s) => s.stepNumber === stepNumber);
      if (!step || step.status !== 'awaiting_approval') {
        throw new AppError('Step not awaiting approval', ErrorCode.CONFLICT);
      }
      const ctx: { lastCanvasId?: string } = {};
      step.output = await executeTool(tenantId, userId, step.tool, step.input, ctx);
      step.status = 'done';
      session.status = 'completed';
      sessions.set(sessionId, session);
      return session;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'studio_approval',
    meterEventType: 'api_call',
  });
}
