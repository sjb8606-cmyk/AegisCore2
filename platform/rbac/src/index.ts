/**
 * platform/rbac
 *
 * Role-based access control — roles, permissions, user→role binding, check().
 * Platform-level service; apps declare required permission per action/route.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('rbac');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultRole: z.string().default('viewer'),
  superPermission: z.string().default('*'),
});

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  permissions: string[];
  createdAt: string;
}

export interface UserRoleBinding {
  userId: string;
  tenantId: string;
  roleId: string;
  roleName: string;
}

const roles = new Map<string, Role>(); // id → role
const bindings = new Map<string, UserRoleBinding>(); // tenant:userId → binding

export function __resetRbacStore(): void {
  roles.clear();
  bindings.clear();
}

function bindKey(tenantId: string, userId: string): string {
  return tenantId + ':' + userId;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('rbac', ConfigSchema);
}

export function permissionMatches(
  granted: string[],
  required: string,
  superPermission = '*',
): boolean {
  if (granted.includes(superPermission) || granted.includes(required)) {
    return true;
  }
  // namespace wildcards: inventory.* matches inventory.read
  for (const g of granted) {
    if (g.endsWith('.*')) {
      const prefix = g.slice(0, -1); // keep trailing path style "inventory."
      if (required.startsWith(prefix) || required.startsWith(g.slice(0, -2))) {
        return true;
      }
      if (required.startsWith(g.slice(0, -1))) return true;
    }
  }
  return false;
}

export async function createRole(
  tenantId: string,
  actorId: string,
  input: { name: string; permissions: string[] },
): Promise<Role> {
  return runCrudOperation({
    configName: 'rbac',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      const existing = [...roles.values()].find(
        (r) => r.tenantId === tenantId && r.name === input.name.trim(),
      );
      if (existing) {
        throw new AppError('Role already exists', ErrorCode.CONFLICT);
      }
      const role: Role = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        permissions: [...new Set(input.permissions || [])],
        createdAt: new Date().toISOString(),
      };
      roles.set(role.id, role);
      return role;
    },
    auditAction: 'data.created',
    auditResource: 'rbac_role',
    meterEventType: 'api_call',
  });
}

export async function assignRole(
  tenantId: string,
  actorId: string,
  input: { userId: string; roleId: string },
): Promise<UserRoleBinding> {
  return runCrudOperation({
    configName: 'rbac',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.userId?.trim()) {
        throw new AppError('userId required', ErrorCode.BAD_REQUEST);
      }
      const role = roles.get(input.roleId);
      if (!role || role.tenantId !== tenantId) {
        throw new AppError('Role not found', ErrorCode.NOT_FOUND);
      }
      const binding: UserRoleBinding = {
        userId: input.userId,
        tenantId,
        roleId: role.id,
        roleName: role.name,
      };
      bindings.set(bindKey(tenantId, input.userId), binding);
      logger.info(
        { userId: input.userId, role: role.name },
        'Role assigned',
      );
      return binding;
    },
    auditAction: 'data.updated',
    auditResource: 'rbac_binding',
    meterEventType: 'api_call',
  });
}

export async function check(
  tenantId: string,
  userId: string,
  requiredPermission: string,
): Promise<{ allowed: boolean; roleName: string | null }> {
  const config = await loadCfg();
  const binding = bindings.get(bindKey(tenantId, userId));
  if (!binding) {
    return { allowed: false, roleName: null };
  }
  const role = roles.get(binding.roleId);
  if (!role) {
    return { allowed: false, roleName: binding.roleName };
  }
  const allowed = permissionMatches(
    role.permissions,
    requiredPermission,
    config.superPermission,
  );
  return { allowed, roleName: role.name };
}

export async function assertPermission(
  tenantId: string,
  userId: string,
  requiredPermission: string,
): Promise<void> {
  const result = await check(tenantId, userId, requiredPermission);
  if (!result.allowed) {
    throw new AppError(
      'Forbidden: requires ' + requiredPermission,
      ErrorCode.FORBIDDEN,
    );
  }
}

export async function getUserRole(
  tenantId: string,
  userId: string,
): Promise<UserRoleBinding | null> {
  return bindings.get(bindKey(tenantId, userId)) || null;
}

export async function listRoles(tenantId: string): Promise<Role[]> {
  return [...roles.values()].filter((r) => r.tenantId === tenantId);
}

export async function updateRolePermissions(
  tenantId: string,
  actorId: string,
  roleId: string,
  permissions: string[],
): Promise<Role> {
  return runCrudOperation({
    configName: 'rbac',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const role = roles.get(roleId);
      if (!role || role.tenantId !== tenantId) {
        throw new AppError('Role not found', ErrorCode.NOT_FOUND);
      }
      role.permissions = [...new Set(permissions)];
      roles.set(roleId, role);
      return role;
    },
    auditAction: 'data.updated',
    auditResource: 'rbac_role',
    meterEventType: 'api_call',
  });
}
