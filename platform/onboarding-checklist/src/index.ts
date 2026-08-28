/**
 * platform/onboarding-checklist (HR-02)
 *
 * Role-based onboarding templates, task completion, blocker until required done.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('onboarding-checklist');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockUntilRequiredComplete: z.boolean().default(true),
});

export interface ChecklistTemplateTask {
  key: string;
  label: string;
  required: boolean;
  dueDaysFromStart: number;
}

export interface OnboardingTemplate {
  id: string;
  tenantId: string;
  roleKey: string;
  name: string;
  tasks: ChecklistTemplateTask[];
  active: boolean;
}

export type TaskStatus = 'pending' | 'done' | 'skipped';

export interface OnboardingTaskInstance {
  key: string;
  label: string;
  required: boolean;
  dueAt: string;
  status: TaskStatus;
  completedAt: string | null;
  completedBy: string | null;
}

export interface OnboardingRun {
  id: string;
  tenantId: string;
  employeeId: string;
  templateId: string;
  roleKey: string;
  startDate: string;
  tasks: OnboardingTaskInstance[];
  status: 'in_progress' | 'completed';
  createdAt: string;
}

const templates = new Map<string, OnboardingTemplate>();
const runs = new Map<string, OnboardingRun>();

export function __resetOnboardingChecklistStore(): void {
  templates.clear();
  runs.clear();
}

export async function createTemplate(
  tenantId: string,
  actorId: string,
  input: {
    roleKey: string;
    name: string;
    tasks: ChecklistTemplateTask[];
  },
): Promise<OnboardingTemplate> {
  return runCrudOperation({
    configName: 'onboarding-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.roleKey?.trim() || !input.name?.trim()) {
        throw new AppError('roleKey and name required', ErrorCode.BAD_REQUEST);
      }
      if (!input.tasks?.length) {
        throw new AppError('tasks required', ErrorCode.BAD_REQUEST);
      }
      for (const t of input.tasks) {
        if (!t.key?.trim() || !t.label?.trim()) {
          throw new AppError('task key and label required', ErrorCode.BAD_REQUEST);
        }
      }
      const tpl: OnboardingTemplate = {
        id: crypto.randomUUID(),
        tenantId,
        roleKey: input.roleKey.trim().toLowerCase(),
        name: input.name.trim(),
        tasks: input.tasks.map((t) => ({
          key: t.key.trim(),
          label: t.label.trim(),
          required: !!t.required,
          dueDaysFromStart: t.dueDaysFromStart ?? 7,
        })),
        active: true,
      };
      templates.set(tpl.id, tpl);
      return tpl;
    },
    auditAction: 'data.created',
    auditResource: 'hr_onboarding_template',
    meterEventType: 'api_call',
  });
}

export async function startOnboarding(
  tenantId: string,
  actorId: string,
  input: {
    employeeId: string;
    templateId: string;
    startDate?: string;
  },
): Promise<OnboardingRun> {
  return runCrudOperation({
    configName: 'onboarding-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.employeeId?.trim()) {
        throw new AppError('employeeId required', ErrorCode.BAD_REQUEST);
      }
      const tpl = templates.get(input.templateId);
      if (!tpl || tpl.tenantId !== tenantId || !tpl.active) {
        throw new AppError('Template not found', ErrorCode.NOT_FOUND);
      }
      const start = input.startDate
        ? Date.parse(input.startDate)
        : Date.now();
      if (Number.isNaN(start)) {
        throw new AppError('invalid startDate', ErrorCode.BAD_REQUEST);
      }
      const startIso = new Date(start).toISOString();
      const tasks: OnboardingTaskInstance[] = tpl.tasks.map((t) => ({
        key: t.key,
        label: t.label,
        required: t.required,
        dueAt: new Date(start + t.dueDaysFromStart * 86_400_000).toISOString(),
        status: 'pending',
        completedAt: null,
        completedBy: null,
      }));
      const run: OnboardingRun = {
        id: crypto.randomUUID(),
        tenantId,
        employeeId: input.employeeId,
        templateId: tpl.id,
        roleKey: tpl.roleKey,
        startDate: startIso,
        tasks,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
      };
      runs.set(run.id, run);
      return run;
    },
    auditAction: 'data.created',
    auditResource: 'hr_onboarding_run',
    meterEventType: 'api_call',
  });
}

export async function completeTask(
  tenantId: string,
  actorId: string,
  runId: string,
  taskKey: string,
): Promise<OnboardingRun> {
  return runCrudOperation({
    configName: 'onboarding-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const run = runs.get(runId);
      if (!run || run.tenantId !== tenantId) {
        throw new AppError('Onboarding run not found', ErrorCode.NOT_FOUND);
      }
      if (run.status === 'completed') {
        throw new AppError('Onboarding already completed', ErrorCode.CONFLICT);
      }
      const task = run.tasks.find((t) => t.key === taskKey);
      if (!task) {
        throw new AppError('Task not found', ErrorCode.NOT_FOUND);
      }
      if (task.status === 'done') {
        throw new AppError('Task already done', ErrorCode.CONFLICT);
      }
      task.status = 'done';
      task.completedAt = new Date().toISOString();
      task.completedBy = actorId;

      const requiredPending = run.tasks.some(
        (t) => t.required && t.status !== 'done',
      );
      if (!requiredPending) {
        run.status = 'completed';
        logger.info({ runId, employeeId: run.employeeId }, 'Onboarding completed');
      }
      runs.set(runId, run);
      return run;
    },
    auditAction: 'data.updated',
    auditResource: 'hr_onboarding_run',
    meterEventType: 'api_call',
  });
}

export async function assertOnboardingComplete(
  tenantId: string,
  employeeId: string,
): Promise<{ complete: boolean; runId: string | null; pendingRequired: string[] }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('onboarding-checklist', ConfigSchema);
  const run = [...runs.values()]
    .filter((r) => r.tenantId === tenantId && r.employeeId === employeeId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  if (!run) {
    if (config.blockUntilRequiredComplete) {
      throw new AppError('No onboarding run found', ErrorCode.FORBIDDEN);
    }
    return { complete: true, runId: null, pendingRequired: [] };
  }
  const pendingRequired = run.tasks
    .filter((t) => t.required && t.status !== 'done')
    .map((t) => t.key);
  if (pendingRequired.length > 0 && config.blockUntilRequiredComplete) {
    throw new AppError(
      'Onboarding incomplete: ' + pendingRequired.join(', '),
      ErrorCode.FORBIDDEN,
    );
  }
  return {
    complete: pendingRequired.length === 0,
    runId: run.id,
    pendingRequired,
  };
}

export async function getOnboardingRun(
  tenantId: string,
  actorId: string,
  runId: string,
): Promise<OnboardingRun> {
  return runCrudOperation({
    configName: 'onboarding-checklist',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const run = runs.get(runId);
      if (!run || run.tenantId !== tenantId) {
        throw new AppError('Onboarding run not found', ErrorCode.NOT_FOUND);
      }
      return run;
    },
    auditAction: 'data.read',
    auditResource: 'hr_onboarding_run',
    meterEventType: 'api_call',
  });
}
