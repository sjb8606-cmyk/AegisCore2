/**
 * platform/termination-offboarding (HR-05)
 *
 * Termination case + checklist: access cut, asset return, final pay flag.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('termination-offboarding');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTasks: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        required: z.boolean().default(true),
      }),
    )
    .default([
      { key: 'revoke_access', label: 'Revoke system access', required: true },
      { key: 'return_assets', label: 'Return company assets', required: true },
      { key: 'final_pay', label: 'Final pay processed', required: true },
      { key: 'exit_interview', label: 'Exit interview', required: false },
    ]),
});

export type TerminationStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type OffboardTaskStatus = 'pending' | 'done' | 'waived';

export interface OffboardTask {
  key: string;
  label: string;
  required: boolean;
  status: OffboardTaskStatus;
  completedAt: string | null;
  completedBy: string | null;
}

export interface TerminationCase {
  id: string;
  tenantId: string;
  employeeId: string;
  effectiveDate: string;
  reason: string | null;
  status: TerminationStatus;
  accessRevoked: boolean;
  finalPayReady: boolean;
  tasks: OffboardTask[];
  createdAt: string;
  closedAt: string | null;
}

const cases = new Map<string, TerminationCase>();

export function __resetTerminationOffboardingStore(): void {
  cases.clear();
}

function getCase(tenantId: string, caseId: string): TerminationCase {
  const c = cases.get(caseId);
  if (!c || c.tenantId !== tenantId) {
    throw new AppError('Termination case not found', ErrorCode.NOT_FOUND);
  }
  return c;
}

export async function openTermination(
  tenantId: string,
  actorId: string,
  input: {
    employeeId: string;
    effectiveDate: string;
    reason?: string;
  },
): Promise<TerminationCase> {
  return runCrudOperation({
    configName: 'termination-offboarding',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('termination-offboarding', ConfigSchema);
      if (!input.employeeId?.trim()) {
        throw new AppError('employeeId required', ErrorCode.BAD_REQUEST);
      }
      const effective = Date.parse(input.effectiveDate);
      if (Number.isNaN(effective)) {
        throw new AppError('invalid effectiveDate', ErrorCode.BAD_REQUEST);
      }
      const existing = [...cases.values()].find(
        (c) =>
          c.tenantId === tenantId &&
          c.employeeId === input.employeeId &&
          (c.status === 'open' || c.status === 'in_progress'),
      );
      if (existing) {
        throw new AppError('Open termination already exists', ErrorCode.CONFLICT);
      }
      const tasks: OffboardTask[] = config.defaultTasks.map((t) => ({
        key: t.key,
        label: t.label,
        required: t.required,
        status: 'pending',
        completedAt: null,
        completedBy: null,
      }));
      const row: TerminationCase = {
        id: crypto.randomUUID(),
        tenantId,
        employeeId: input.employeeId,
        effectiveDate: new Date(effective).toISOString(),
        reason: input.reason?.trim() || null,
        status: 'open',
        accessRevoked: false,
        finalPayReady: false,
        tasks,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      cases.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'hr_termination_case',
    meterEventType: 'api_call',
  });
}

export async function completeOffboardTask(
  tenantId: string,
  actorId: string,
  caseId: string,
  taskKey: string,
): Promise<TerminationCase> {
  return runCrudOperation({
    configName: 'termination-offboarding',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const c = getCase(tenantId, caseId);
      if (c.status === 'completed' || c.status === 'cancelled') {
        throw new AppError('Case is closed', ErrorCode.CONFLICT);
      }
      const task = c.tasks.find((t) => t.key === taskKey);
      if (!task) {
        throw new AppError('Task not found', ErrorCode.NOT_FOUND);
      }
      if (task.status === 'done') {
        throw new AppError('Task already done', ErrorCode.CONFLICT);
      }
      task.status = 'done';
      task.completedAt = new Date().toISOString();
      task.completedBy = actorId;
      if (taskKey === 'revoke_access') c.accessRevoked = true;
      if (taskKey === 'final_pay') c.finalPayReady = true;
      c.status = 'in_progress';
      cases.set(caseId, c);
      return c;
    },
    auditAction: 'data.updated',
    auditResource: 'hr_termination_case',
    meterEventType: 'api_call',
  });
}

export async function closeTermination(
  tenantId: string,
  actorId: string,
  caseId: string,
): Promise<TerminationCase> {
  return runCrudOperation({
    configName: 'termination-offboarding',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const c = getCase(tenantId, caseId);
      if (c.status === 'completed') {
        throw new AppError('Already completed', ErrorCode.CONFLICT);
      }
      if (c.status === 'cancelled') {
        throw new AppError('Case cancelled', ErrorCode.CONFLICT);
      }
      const pendingRequired = c.tasks.filter(
        (t) => t.required && t.status !== 'done' && t.status !== 'waived',
      );
      if (pendingRequired.length > 0) {
        throw new AppError(
          'Required tasks incomplete: ' +
            pendingRequired.map((t) => t.key).join(', '),
          ErrorCode.CONFLICT,
        );
      }
      c.status = 'completed';
      c.closedAt = new Date().toISOString();
      cases.set(caseId, c);
      logger.info({ caseId, employeeId: c.employeeId }, 'Termination closed');
      return c;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hr_termination_case',
    meterEventType: 'api_call',
  });
}

export async function assertAccessRevoked(
  tenantId: string,
  employeeId: string,
): Promise<{ revoked: boolean; caseId: string | null }> {
  const c = [...cases.values()].find(
    (x) =>
      x.tenantId === tenantId &&
      x.employeeId === employeeId &&
      x.status !== 'cancelled',
  );
  if (!c) {
    return { revoked: false, caseId: null };
  }
  if (!c.accessRevoked) {
    throw new AppError('Access not yet revoked', ErrorCode.FORBIDDEN);
  }
  return { revoked: true, caseId: c.id };
}

export async function getTerminationCase(
  tenantId: string,
  actorId: string,
  caseId: string,
): Promise<TerminationCase> {
  return runCrudOperation({
    configName: 'termination-offboarding',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getCase(tenantId, caseId),
    auditAction: 'data.read',
    auditResource: 'hr_termination_case',
    meterEventType: 'api_call',
  });
}
