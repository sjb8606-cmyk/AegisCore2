/**
 * platform/planner-entities
 *
 * The thing/person being planned around (animal, patient, task, client).
 * Shape controlled by niche config (entityLabel, customFields, tagVocabulary).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('planner-entities');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  niche: z.string().default('generic'),
  entityLabel: z.string().default('entity'),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'date']),
      }),
    )
    .default([]),
  tagVocabulary: z.array(z.string()).default([]),
});

export type PlannerEntitiesConfig = z.infer<typeof ConfigSchema>;

export type EntityStatus =
  | 'available'
  | 'assigned'
  | 'completed'
  | 'inactive';

export interface PlannerEntity {
  id: string;
  tenantId: string;
  niche: string;
  name: string;
  status: EntityStatus;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const entities = new Map<string, PlannerEntity>();

export function __resetPlannerEntitiesStore(): void {
  entities.clear();
}

async function loadCfg(): Promise<PlannerEntitiesConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('planner-entities', ConfigSchema);
}

function validateTags(tags: string[], vocabulary: string[]): void {
  if (!vocabulary.length) return;
  for (const t of tags) {
    if (!vocabulary.includes(t)) {
      throw new AppError(
        `Tag '${t}' not in vocabulary`,
        ErrorCode.BAD_REQUEST,
      );
    }
  }
}

export async function createEntity(
  tenantId: string,
  actorId: string,
  input: {
    niche?: string;
    name: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
    status?: EntityStatus;
  },
): Promise<PlannerEntity> {
  return runCrudOperation({
    configName: 'planner-entities',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      const tags = input.tags || [];
      validateTags(tags, config.tagVocabulary);

      const now = new Date().toISOString();
      const entity: PlannerEntity = {
        id: crypto.randomUUID(),
        tenantId,
        niche: input.niche || config.niche,
        name: input.name.trim(),
        status: input.status || 'available',
        tags,
        customFields: input.customFields || {},
        createdAt: now,
        updatedAt: now,
      };
      entities.set(entity.id, entity);
      logger.info(
        { entityId: entity.id, niche: entity.niche },
        'Entity created',
      );
      return entity;
    },
    auditAction: 'data.created',
    auditResource: 'planner_entity',
    meterEventType: 'api_call',
  });
}

export async function updateEntity(
  tenantId: string,
  actorId: string,
  entityId: string,
  patch: Partial<
    Pick<PlannerEntity, 'name' | 'status' | 'tags' | 'customFields'>
  >,
): Promise<PlannerEntity> {
  return runCrudOperation({
    configName: 'planner-entities',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const entity = entities.get(entityId);
      if (!entity || entity.tenantId !== tenantId) {
        throw new AppError('Entity not found', ErrorCode.NOT_FOUND);
      }
      if (patch.tags) validateTags(patch.tags, config.tagVocabulary);
      if (patch.name != null) entity.name = patch.name.trim();
      if (patch.status) entity.status = patch.status;
      if (patch.tags) entity.tags = patch.tags;
      if (patch.customFields) {
        entity.customFields = { ...entity.customFields, ...patch.customFields };
      }
      entity.updatedAt = new Date().toISOString();
      entities.set(entityId, entity);
      return entity;
    },
    auditAction: 'data.updated',
    auditResource: 'planner_entity',
    meterEventType: 'api_call',
  });
}

export async function getEntity(
  tenantId: string,
  entityId: string,
): Promise<PlannerEntity | null> {
  const e = entities.get(entityId);
  if (!e || e.tenantId !== tenantId) return null;
  return e;
}

export async function listEntities(
  tenantId: string,
  filter?: { niche?: string; status?: EntityStatus; tag?: string },
): Promise<PlannerEntity[]> {
  return [...entities.values()].filter((e) => {
    if (e.tenantId !== tenantId) return false;
    if (filter?.niche && e.niche !== filter.niche) return false;
    if (filter?.status && e.status !== filter.status) return false;
    if (filter?.tag && !e.tags.includes(filter.tag)) return false;
    return true;
  });
}
