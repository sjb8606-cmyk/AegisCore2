/**
 * platform/hitl-confirm-gate
 *
 * Intercept commit → present prompts → block until human response → allow/reject.
 * Lightweight verification step for QC, publish, financial, Veridact-style flows.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('hitl-confirm-gate');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  gatedActions: z.array(z.string()).default([]),
  defaultPrompts: z.array(z.string()).default(['Confirm this action?']),
  allowedConfirmRoles: z.array(z.string()).default(['admin', 'reviewer', 'operator']),
  ttlMinutes: z.number().int().positive().default(60),
});

export type GateStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

export interface ConfirmPrompt {
  id: string;
  text: string;
  required: boolean;
  response: boolean | null;
}

export interface ConfirmGate {
  id: string;
  tenantId: string;
  actionId: string;
  actionType: string;
  payload: Record<string, unknown>;
  prompts: ConfirmPrompt[];
  status: GateStatus;
  requestedBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  expiresAt: string;
}

const gates = new Map<string, ConfirmGate>();

export function __resetHitlConfirmGateStore(): void {
  gates.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('hitl-confirm-gate', ConfigSchema);
}

export function requiresGate(actionType: string, gatedActions: string[]): boolean {
  if (!gatedActions.length) return true; // empty list = gate everything when called
  return gatedActions.includes(actionType) || gatedActions.includes('*');
}

export async function openGate(
  tenantId: string,
  actorId: string,
  input: {
    actionId: string;
    actionType: string;
    payload?: Record<string, unknown>;
    prompts?: { text: string; required?: boolean }[];
  },
): Promise<ConfirmGate> {
  return runCrudOperation({
    configName: 'hitl-confirm-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.actionId?.trim() || !input.actionType?.trim()) {
        throw new AppError('actionId and actionType required', ErrorCode.BAD_REQUEST);
      }
      if (!requiresGate(input.actionType, config.gatedActions) && config.gatedActions.length) {
        // still create an auto-confirmed gate for audit uniformity
      }
      const promptSources =
        input.prompts && input.prompts.length
          ? input.prompts
          : config.defaultPrompts.map((t) => ({ text: t, required: true }));

      const now = Date.now();
      const gate: ConfirmGate = {
        id: crypto.randomUUID(),
        tenantId,
        actionId: input.actionId,
        actionType: input.actionType,
        payload: input.payload || {},
        prompts: promptSources.map((p) => ({
          id: crypto.randomUUID(),
          text: p.text,
          required: p.required !== false,
          response: null,
        })),
        status: 'pending',
        requestedBy: actorId,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + config.ttlMinutes * 60_000).toISOString(),
      };
      gates.set(gate.id, gate);
      logger.info({ gateId: gate.id, actionType: input.actionType }, 'HITL gate opened');
      return gate;
    },
    auditAction: 'data.created',
    auditResource: 'confirm_gate',
    meterEventType: 'api_call',
  });
}

export async function respondGate(
  tenantId: string,
  actorId: string,
  gateId: string,
  input: {
    responses: { promptId: string; value: boolean }[];
    role?: string;
    reject?: boolean;
  },
): Promise<ConfirmGate> {
  return runCrudOperation({
    configName: 'hitl-confirm-gate',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const gate = gates.get(gateId);
      if (!gate || gate.tenantId !== tenantId) {
        throw new AppError('Gate not found', ErrorCode.NOT_FOUND);
      }
      if (gate.status !== 'pending') {
        throw new AppError('Gate is not pending', ErrorCode.CONFLICT);
      }
      if (new Date(gate.expiresAt).getTime() < Date.now()) {
        gate.status = 'expired';
        gates.set(gateId, gate);
        throw new AppError('Gate expired', ErrorCode.CONFLICT);
      }
      if (
        input.role &&
        config.allowedConfirmRoles.length &&
        !config.allowedConfirmRoles.includes(input.role)
      ) {
        throw new AppError('Role not allowed to confirm', ErrorCode.FORBIDDEN);
      }

      if (input.reject) {
        gate.status = 'rejected';
        gate.confirmedBy = actorId;
        gate.confirmedAt = new Date().toISOString();
        gates.set(gateId, gate);
        return gate;
      }

      for (const r of input.responses || []) {
        const prompt = gate.prompts.find((p) => p.id === r.promptId);
        if (prompt) prompt.response = r.value;
      }

      const missingRequired = gate.prompts.filter(
        (p) => p.required && p.response === null,
      );
      if (missingRequired.length) {
        throw new AppError(
          'Missing response for required prompt',
          ErrorCode.BAD_REQUEST,
        );
      }

      const anyNo = gate.prompts.some((p) => p.required && p.response === false);
      if (anyNo) {
        gate.status = 'rejected';
      } else {
        gate.status = 'confirmed';
      }
      gate.confirmedBy = actorId;
      gate.confirmedAt = new Date().toISOString();
      gates.set(gateId, gate);
      logger.info({ gateId, status: gate.status }, 'HITL gate closed');
      return gate;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'confirm_gate',
    meterEventType: 'api_call',
  });
}

export async function assertConfirmed(
  tenantId: string,
  actionId: string,
): Promise<ConfirmGate> {
  const gate = [...gates.values()].find(
    (g) =>
      g.tenantId === tenantId &&
      g.actionId === actionId &&
      g.status === 'confirmed',
  );
  if (!gate) {
    throw new AppError('Action not confirmed', ErrorCode.FORBIDDEN);
  }
  return gate;
}

export async function getGate(
  tenantId: string,
  gateId: string,
): Promise<ConfirmGate | null> {
  const g = gates.get(gateId);
  if (!g || g.tenantId !== tenantId) return null;
  return g;
}

export async function listPending(
  tenantId: string,
): Promise<ConfirmGate[]> {
  const now = Date.now();
  return [...gates.values()].filter((g) => {
    if (g.tenantId !== tenantId) return false;
    if (g.status === 'pending' && new Date(g.expiresAt).getTime() < now) {
      g.status = 'expired';
      gates.set(g.id, g);
      return false;
    }
    return g.status === 'pending';
  });
}
