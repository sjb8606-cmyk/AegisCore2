/**
 * platform/workflow-state
 *
 * Config-driven state machine: states + allowed transitions + history + hooks.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('workflow-state');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxHistory: z.number().int().positive().default(200),
});

export interface TransitionDef {
  from: string;
  to: string;
  hook?: string; // notify | alert | webhook | none
}

export interface WorkflowDef {
  id: string;
  tenantId: string;
  entityType: string;
  states: string[];
  initialState: string;
  transitions: TransitionDef[];
  createdAt: string;
}

export interface StateHistoryEntry {
  from: string | null;
  to: string;
  at: string;
  by: string;
  note?: string;
}

export interface EntityState {
  entityId: string;
  tenantId: string;
  entityType: string;
  currentState: string;
  history: StateHistoryEntry[];
  updatedAt: string;
}

type HookFn = (
  entityType: string,
  entityId: string,
  from: string,
  to: string,
  hook: string,
) => Promise<void> | void;

const defs = new Map<string, WorkflowDef>(); // key tenant:entityType
const states = new Map<string, EntityState>(); // key tenant:entityType:entityId
let hookFn: HookFn = async () => {};

export function __resetWorkflowStateStore(): void {
  defs.clear();
  states.clear();
  hookFn = async () => {};
}

export function setHookFn(fn: HookFn): void {
  hookFn = fn;
}

function defKey(tenantId: string, entityType: string): string {
  return tenantId + ':' + entityType;
}
function entityKey(
  tenantId: string,
  entityType: string,
  entityId: string,
): string {
  return tenantId + ':' + entityType + ':' + entityId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('workflow-state', ConfigSchema);
}

export function isTransitionAllowed(
  def: WorkflowDef,
  from: string,
  to: string,
): TransitionDef | null {
  return (
    def.transitions.find((t) => t.from === from && t.to === to) || null
  );
}

export async function registerWorkflow(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    states: string[];
    initialState: string;
    transitions: TransitionDef[];
  },
): Promise<WorkflowDef> {
  return runCrudOperation({
    configName: 'workflow-state',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.entityType?.trim()) {
        throw new AppError('entityType required', ErrorCode.BAD_REQUEST);
      }
      if (!input.states?.length) {
        throw new AppError('states required', ErrorCode.BAD_REQUEST);
      }
      if (!input.states.includes(input.initialState)) {
        throw new AppError(
          'initialState must be in states',
          ErrorCode.BAD_REQUEST,
        );
      }
      for (const t of input.transitions || []) {
        if (!input.states.includes(t.from) || !input.states.includes(t.to)) {
          throw new AppError(
            'transition references unknown state',
            ErrorCode.BAD_REQUEST,
          );
        }
      }
      const def: WorkflowDef = {
        id: crypto.randomUUID(),
        tenantId,
        entityType: input.entityType.trim(),
        states: input.states,
        initialState: input.initialState,
        transitions: input.transitions || [],
        createdAt: new Date().toISOString(),
      };
      defs.set(defKey(tenantId, def.entityType), def);
      return def;
    },
    auditAction: 'data.created',
    auditResource: 'workflow_def',
    meterEventType: 'api_call',
  });
}

export async function initEntity(
  tenantId: string,
  actorId: string,
  input: { entityType: string; entityId: string },
): Promise<EntityState> {
  return runCrudOperation({
    configName: 'workflow-state',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const def = defs.get(defKey(tenantId, input.entityType));
      if (!def) {
        throw new AppError('Workflow not registered', ErrorCode.NOT_FOUND);
      }
      const k = entityKey(tenantId, input.entityType, input.entityId);
      if (states.has(k)) {
        return states.get(k)!;
      }
      const now = new Date().toISOString();
      const es: EntityState = {
        entityId: input.entityId,
        tenantId,
        entityType: input.entityType,
        currentState: def.initialState,
        history: [
          {
            from: null,
            to: def.initialState,
            at: now,
            by: actorId,
            note: 'initialized',
          },
        ],
        updatedAt: now,
      };
      states.set(k, es);
      return es;
    },
    auditAction: 'data.created',
    auditResource: 'entity_state',
    meterEventType: 'api_call',
  });
}

export async function transition(
  tenantId: string,
  actorId: string,
  input: {
    entityType: string;
    entityId: string;
    newState: string;
    note?: string;
  },
): Promise<EntityState> {
  return runCrudOperation({
    configName: 'workflow-state',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const def = defs.get(defKey(tenantId, input.entityType));
      if (!def) {
        throw new AppError('Workflow not registered', ErrorCode.NOT_FOUND);
      }
      const k = entityKey(tenantId, input.entityType, input.entityId);
      let es = states.get(k);
      if (!es) {
        es = await initEntity(tenantId, actorId, {
          entityType: input.entityType,
          entityId: input.entityId,
        });
      }
      const allowed = isTransitionAllowed(
        def,
        es.currentState,
        input.newState,
      );
      if (!allowed) {
        throw new AppError(
          'Transition not allowed: ' +
            es.currentState +
            ' → ' +
            input.newState,
          ErrorCode.FORBIDDEN,
        );
      }
      const from = es.currentState;
      const now = new Date().toISOString();
      es.history.push({
        from,
        to: input.newState,
        at: now,
        by: actorId,
        note: input.note,
      });
      if (es.history.length > config.maxHistory) {
        es.history = es.history.slice(-config.maxHistory);
      }
      es.currentState = input.newState;
      es.updatedAt = now;
      states.set(k, es);

      if (allowed.hook && allowed.hook !== 'none') {
        await hookFn(
          input.entityType,
          input.entityId,
          from,
          input.newState,
          allowed.hook,
        );
      }
      logger.info(
        {
          entityType: input.entityType,
          entityId: input.entityId,
          from,
          to: input.newState,
        },
        'State transition',
      );
      return es;
    },
    auditAction: 'data.updated',
    auditResource: 'entity_state',
    meterEventType: 'api_call',
  });
}

export async function getEntityState(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<EntityState | null> {
  return states.get(entityKey(tenantId, entityType, entityId)) || null;
}

export async function getWorkflow(
  tenantId: string,
  entityType: string,
): Promise<WorkflowDef | null> {
  return defs.get(defKey(tenantId, entityType)) || null;
}
