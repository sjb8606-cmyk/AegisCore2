/**
 * platform/org-reporting-line (HR-03)
 *
 * Manager chain, cycle detection, approval routing, direct reports.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('org-reporting-line');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxChainDepth: z.number().int().positive().default(20),
  allowSelfManage: z.boolean().default(false),
});

export interface OrgNode {
  tenantId: string;
  employeeId: string;
  managerId: string | null;
  title: string | null;
  updatedAt: string;
}

const nodes = new Map<string, OrgNode>();

export function __resetOrgReportingStore(): void {
  nodes.clear();
}

function nodeKey(tenantId: string, employeeId: string): string {
  return tenantId + ':' + employeeId;
}

function wouldCreateCycle(
  tenantId: string,
  employeeId: string,
  managerId: string,
  maxDepth: number,
): boolean {
  let current: string | null = managerId;
  let depth = 0;
  while (current) {
    if (current === employeeId) return true;
    depth += 1;
    if (depth > maxDepth) return true;
    const n = nodes.get(nodeKey(tenantId, current));
    current = n?.managerId ?? null;
  }
  return false;
}

export async function upsertEmployeeNode(
  tenantId: string,
  actorId: string,
  input: {
    employeeId: string;
    managerId?: string | null;
    title?: string;
  },
): Promise<OrgNode> {
  return runCrudOperation({
    configName: 'org-reporting-line',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('org-reporting-line', ConfigSchema);
      if (!input.employeeId?.trim()) {
        throw new AppError('employeeId required', ErrorCode.BAD_REQUEST);
      }
      const managerId =
        input.managerId === undefined
          ? nodes.get(nodeKey(tenantId, input.employeeId))?.managerId ?? null
          : input.managerId;

      if (managerId === input.employeeId && !config.allowSelfManage) {
        throw new AppError('Employee cannot manage self', ErrorCode.BAD_REQUEST);
      }
      if (
        managerId &&
        wouldCreateCycle(
          tenantId,
          input.employeeId,
          managerId,
          config.maxChainDepth,
        )
      ) {
        throw new AppError('Manager assignment would create a cycle', ErrorCode.CONFLICT);
      }
      if (managerId && !nodes.has(nodeKey(tenantId, managerId))) {
        // allow dangling manager only if we also create a stub
        nodes.set(nodeKey(tenantId, managerId), {
          tenantId,
          employeeId: managerId,
          managerId: null,
          title: null,
          updatedAt: new Date().toISOString(),
        });
      }

      const existing = nodes.get(nodeKey(tenantId, input.employeeId));
      const node: OrgNode = {
        tenantId,
        employeeId: input.employeeId,
        managerId: managerId ?? null,
        title:
          input.title !== undefined
            ? input.title?.trim() || null
            : existing?.title ?? null,
        updatedAt: new Date().toISOString(),
      };
      nodes.set(nodeKey(tenantId, input.employeeId), node);
      return node;
    },
    auditAction: 'data.updated',
    auditResource: 'hr_org_node',
    meterEventType: 'api_call',
  });
}

export async function getManagerChain(
  tenantId: string,
  actorId: string,
  employeeId: string,
): Promise<string[]> {
  return runCrudOperation({
    configName: 'org-reporting-line',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('org-reporting-line', ConfigSchema);
      const chain: string[] = [];
      let current: string | null = employeeId;
      const seen = new Set<string>();
      while (current) {
        const n = nodes.get(nodeKey(tenantId, current));
        if (!n?.managerId) break;
        if (seen.has(n.managerId)) {
          throw new AppError('Cycle detected in org chart', ErrorCode.CONFLICT);
        }
        seen.add(n.managerId);
        chain.push(n.managerId);
        if (chain.length > config.maxChainDepth) {
          throw new AppError('Chain exceeds max depth', ErrorCode.CONFLICT);
        }
        current = n.managerId;
      }
      return chain;
    },
    auditAction: 'data.read',
    auditResource: 'hr_org_node',
    meterEventType: 'api_call',
  });
}

export async function getDirectReports(
  tenantId: string,
  actorId: string,
  managerId: string,
): Promise<OrgNode[]> {
  return runCrudOperation({
    configName: 'org-reporting-line',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...nodes.values()].filter(
        (n) => n.tenantId === tenantId && n.managerId === managerId,
      ),
    auditAction: 'data.read',
    auditResource: 'hr_org_node',
    meterEventType: 'api_call',
  });
}

export async function resolveApprover(
  tenantId: string,
  actorId: string,
  employeeId: string,
  levelsUp = 1,
): Promise<{ approverId: string | null; chain: string[] }> {
  return runCrudOperation({
    configName: 'org-reporting-line',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (levelsUp < 1) {
        throw new AppError('levelsUp must be >= 1', ErrorCode.BAD_REQUEST);
      }
      const chain: string[] = [];
      let current: string | null = employeeId;
      for (let i = 0; i < levelsUp; i++) {
        const n = nodes.get(nodeKey(tenantId, current || ''));
        if (!n?.managerId) {
          return { approverId: null, chain };
        }
        chain.push(n.managerId);
        current = n.managerId;
      }
      return { approverId: chain[chain.length - 1] || null, chain };
    },
    auditAction: 'data.read',
    auditResource: 'hr_org_node',
    meterEventType: 'api_call',
  });
}

export async function assertIsManagerOf(
  tenantId: string,
  managerId: string,
  employeeId: string,
): Promise<{ ok: boolean }> {
  const chain: string[] = [];
  let current: string | null = employeeId;
  const seen = new Set<string>();
  while (current) {
    const n = nodes.get(nodeKey(tenantId, current));
    if (!n?.managerId) break;
    if (seen.has(n.managerId)) break;
    seen.add(n.managerId);
    chain.push(n.managerId);
    if (n.managerId === managerId) return { ok: true };
    current = n.managerId;
  }
  throw new AppError('Not in management chain', ErrorCode.FORBIDDEN);
}
