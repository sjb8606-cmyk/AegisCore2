/**
 * platform/planner-actors
 *
 * Registry of care/help providers (fosters, volunteers, staff, CSR employees).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { isActorSuspended } from '@platform/incident-breaker';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('planner-actors');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultReliability: z.number().min(0).max(1).default(0.7),
  minReliability: z.number().min(0).max(1).default(0),
  maxReliability: z.number().min(0).max(1).default(1),
});

export type PlannerActorsConfig = z.infer<typeof ConfigSchema>;

export interface AvailabilityWindow {
  dayOfWeek: number; // 0=Sun
  startHour: number; // 0-23
  endHour: number;
}

export interface PlannerActor {
  id: string;
  tenantId: string;
  niche: string;
  role: string;
  displayName: string;
  reliabilityScore: number;
  availability: AvailabilityWindow[];
  contactMeta: Record<string, unknown>;
  tags: string[];
  csrPartnerId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const actors = new Map<string, PlannerActor>();

export function __resetPlannerActorsStore(): void {
  actors.clear();
}

async function loadCfg(): Promise<PlannerActorsConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('planner-actors', ConfigSchema);
}

export async function createActor(
  tenantId: string,
  adminId: string,
  input: {
    niche: string;
    role: string;
    displayName: string;
    availability?: AvailabilityWindow[];
    contactMeta?: Record<string, unknown>;
    tags?: string[];
    csrPartnerId?: string;
  },
): Promise<PlannerActor> {
  return runCrudOperation({
    configName: 'planner-actors',
    configSchema: ConfigSchema,
    tenantId,
    actorId: adminId,
    action: async () => {
      const config = await loadCfg();
      if (!input.niche || !input.role || !input.displayName?.trim()) {
        throw new AppError(
          'niche, role, displayName are required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const now = new Date().toISOString();
      const actor: PlannerActor = {
        id: crypto.randomUUID(),
        tenantId,
        niche: input.niche,
        role: input.role,
        displayName: input.displayName.trim(),
        reliabilityScore: config.defaultReliability,
        availability: input.availability || [],
        contactMeta: input.contactMeta || {},
        tags: input.tags || [],
        csrPartnerId: input.csrPartnerId || null,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      actors.set(actor.id, actor);
      logger.info({ actorId: actor.id, niche: actor.niche }, 'Actor created');
      return actor;
    },
    auditAction: 'data.created',
    auditResource: 'planner_actor',
    meterEventType: 'api_call',
  });
}

export async function updateActor(
  tenantId: string,
  adminId: string,
  actorId: string,
  patch: Partial<
    Pick<
      PlannerActor,
      'displayName' | 'availability' | 'contactMeta' | 'tags' | 'active' | 'role'
    >
  >,
): Promise<PlannerActor> {
  return runCrudOperation({
    configName: 'planner-actors',
    configSchema: ConfigSchema,
    tenantId,
    actorId: adminId,
    action: async () => {
      const actor = actors.get(actorId);
      if (!actor || actor.tenantId !== tenantId) {
        throw new AppError('Actor not found', ErrorCode.NOT_FOUND);
      }
      if (patch.displayName != null) actor.displayName = patch.displayName.trim();
      if (patch.availability) actor.availability = patch.availability;
      if (patch.contactMeta) actor.contactMeta = patch.contactMeta;
      if (patch.tags) actor.tags = patch.tags;
      if (patch.active != null) actor.active = patch.active;
      if (patch.role) actor.role = patch.role;
      actor.updatedAt = new Date().toISOString();
      actors.set(actorId, actor);
      return actor;
    },
    auditAction: 'data.updated',
    auditResource: 'planner_actor',
    meterEventType: 'api_call',
  });
}

export async function updateReliability(
  tenantId: string,
  systemId: string,
  actorId: string,
  delta: number,
): Promise<PlannerActor> {
  return runCrudOperation({
    configName: 'planner-actors',
    configSchema: ConfigSchema,
    tenantId,
    actorId: systemId,
    actorType: 'service',
    action: async () => {
      const config = await loadCfg();
      const actor = actors.get(actorId);
      if (!actor || actor.tenantId !== tenantId) {
        throw new AppError('Actor not found', ErrorCode.NOT_FOUND);
      }
      let score = actor.reliabilityScore + delta;
      score = Math.max(config.minReliability, Math.min(config.maxReliability, score));
      actor.reliabilityScore = Math.round(score * 1000) / 1000;
      actor.updatedAt = new Date().toISOString();
      actors.set(actorId, actor);
      return actor;
    },
    auditAction: 'data.updated',
    auditResource: 'planner_actor',
    meterEventType: 'api_call',
  });
}

export async function getActor(
  tenantId: string,
  actorId: string,
): Promise<PlannerActor | null> {
  const a = actors.get(actorId);
  if (!a || a.tenantId !== tenantId) return null;
  return a;
}

export async function listActors(
  tenantId: string,
  filter?: {
    niche?: string;
    role?: string;
    activeOnly?: boolean;
    csrPartnerId?: string;
    excludeSuspended?: boolean;
  },
): Promise<PlannerActor[]> {
  return [...actors.values()].filter((a) => {
    if (a.tenantId !== tenantId) return false;
    if (filter?.niche && a.niche !== filter.niche) return false;
    if (filter?.role && a.role !== filter.role) return false;
    if (filter?.activeOnly && !a.active) return false;
    if (filter?.csrPartnerId && a.csrPartnerId !== filter.csrPartnerId) return false;
    if (filter?.excludeSuspended && isActorSuspended(tenantId, a.id)) return false;
    return true;
  });
}
