/**
 * platform/entity-relation
 *
 * Generic parent → child ownership (Customer→Equipment, Site→Asset, Farm→Field).
 * Cascade behavior on parent delete is config-driven.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('entity-relation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  cascadeOnParentDelete: z
    .enum(['delete_children', 'nullify', 'block'])
    .default('block'),
  maxChildrenPerParent: z.number().int().positive().default(1000),
});

export interface ParentEntity {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  createdAt: string;
}

export interface ChildEntity {
  id: string;
  tenantId: string;
  parentId: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  createdAt: string;
}

const parents = new Map<string, ParentEntity>();
const children = new Map<string, ChildEntity>();

export function __resetEntityRelationStore(): void {
  parents.clear();
  children.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('entity-relation', ConfigSchema);
}

export async function createParent(
  tenantId: string,
  actorId: string,
  input: {
    type: string;
    name: string;
    attributes?: Record<string, unknown>;
    id?: string;
  },
): Promise<ParentEntity> {
  return runCrudOperation({
    configName: 'entity-relation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.type?.trim() || !input.name?.trim()) {
        throw new AppError('type and name required', ErrorCode.BAD_REQUEST);
      }
      const parent: ParentEntity = {
        id: input.id || crypto.randomUUID(),
        tenantId,
        type: input.type.trim(),
        name: input.name.trim(),
        attributes: input.attributes || {},
        createdAt: new Date().toISOString(),
      };
      parents.set(parent.id, parent);
      return parent;
    },
    auditAction: 'data.created',
    auditResource: 'parent_entity',
    meterEventType: 'api_call',
  });
}

export async function createChild(
  tenantId: string,
  actorId: string,
  input: {
    parentId: string;
    type: string;
    name: string;
    attributes?: Record<string, unknown>;
  },
): Promise<ChildEntity> {
  return runCrudOperation({
    configName: 'entity-relation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const parent = parents.get(input.parentId);
      if (!parent || parent.tenantId !== tenantId) {
        throw new AppError('Parent not found', ErrorCode.NOT_FOUND);
      }
      if (!input.type?.trim() || !input.name?.trim()) {
        throw new AppError('type and name required', ErrorCode.BAD_REQUEST);
      }
      const existing = [...children.values()].filter(
        (c) => c.tenantId === tenantId && c.parentId === input.parentId,
      );
      if (existing.length >= config.maxChildrenPerParent) {
        throw new AppError('Child limit reached', ErrorCode.FORBIDDEN);
      }
      const child: ChildEntity = {
        id: crypto.randomUUID(),
        tenantId,
        parentId: input.parentId,
        type: input.type.trim(),
        name: input.name.trim(),
        attributes: input.attributes || {},
        createdAt: new Date().toISOString(),
      };
      children.set(child.id, child);
      return child;
    },
    auditAction: 'data.created',
    auditResource: 'child_entity',
    meterEventType: 'api_call',
  });
}

export async function listChildren(
  tenantId: string,
  parentId: string,
  type?: string,
): Promise<ChildEntity[]> {
  return [...children.values()].filter(
    (c) =>
      c.tenantId === tenantId &&
      c.parentId === parentId &&
      (!type || c.type === type),
  );
}

export async function updateChild(
  tenantId: string,
  actorId: string,
  childId: string,
  input: { name?: string; attributes?: Record<string, unknown> },
): Promise<ChildEntity> {
  return runCrudOperation({
    configName: 'entity-relation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const child = children.get(childId);
      if (!child || child.tenantId !== tenantId) {
        throw new AppError('Child not found', ErrorCode.NOT_FOUND);
      }
      if (input.name) child.name = input.name.trim();
      if (input.attributes) {
        child.attributes = { ...child.attributes, ...input.attributes };
      }
      children.set(childId, child);
      return child;
    },
    auditAction: 'data.updated',
    auditResource: 'child_entity',
    meterEventType: 'api_call',
  });
}

export async function deleteChild(
  tenantId: string,
  actorId: string,
  childId: string,
): Promise<{ deleted: boolean }> {
  return runCrudOperation({
    configName: 'entity-relation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const child = children.get(childId);
      if (!child || child.tenantId !== tenantId) {
        throw new AppError('Child not found', ErrorCode.NOT_FOUND);
      }
      children.delete(childId);
      return { deleted: true };
    },
    auditAction: 'data.deleted',
    auditResource: 'child_entity',
    meterEventType: 'api_call',
  });
}

export async function deleteParent(
  tenantId: string,
  actorId: string,
  parentId: string,
): Promise<{ deleted: boolean; childrenAffected: number }> {
  return runCrudOperation({
    configName: 'entity-relation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const parent = parents.get(parentId);
      if (!parent || parent.tenantId !== tenantId) {
        throw new AppError('Parent not found', ErrorCode.NOT_FOUND);
      }
      const kids = [...children.values()].filter(
        (c) => c.tenantId === tenantId && c.parentId === parentId,
      );

      if (config.cascadeOnParentDelete === 'block' && kids.length) {
        throw new AppError(
          'Parent has children; delete blocked',
          ErrorCode.CONFLICT,
        );
      }
      if (config.cascadeOnParentDelete === 'delete_children') {
        for (const k of kids) children.delete(k.id);
      }
      // nullify: keep children but they become orphans (parentId left; caller can reassign)
      parents.delete(parentId);
      logger.info(
        { parentId, cascade: config.cascadeOnParentDelete, n: kids.length },
        'Parent deleted',
      );
      return {
        deleted: true,
        childrenAffected: kids.length,
      };
    },
    auditAction: 'data.deleted',
    auditResource: 'parent_entity',
    meterEventType: 'api_call',
  });
}

export async function getParent(
  tenantId: string,
  parentId: string,
): Promise<ParentEntity | null> {
  const p = parents.get(parentId);
  if (!p || p.tenantId !== tenantId) return null;
  return p;
}

export async function getChild(
  tenantId: string,
  childId: string,
): Promise<ChildEntity | null> {
  const c = children.get(childId);
  if (!c || c.tenantId !== tenantId) return null;
  return c;
}
