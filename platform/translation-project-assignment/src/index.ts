import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode
} from '@platform/crud-kernel';
import { loadConfig } from '@platform/utils';
import { getLogger } from '@platform/observability';

const logger = getLogger('translation-project-assignment');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_words_per_day: z.number().int().positive().default(10000),
  supported_specializations: z.array(
    z.enum(['general', 'legal', 'medical', 'technical', 'marketing'])
  ).default(['general', 'legal', 'medical', 'technical', 'marketing'])
});

export type Specialization =
  | 'general'
  | 'legal'
  | 'medical'
  | 'technical'
  | 'marketing';

export type ProjectStatus =
  | 'intake'
  | 'assigned'
  | 'in_progress'
  | 'qa_review'
  | 'delivered';

export interface TranslationProject {
  project_id: string;
  client_id: string;
  source_language: string;
  target_language: string;
  specialization: Specialization;
  word_count: number;
  deadline: string;
  assigned_linguist_id?: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

const store = new Map<string, TranslationProject>();

function now(): string {
  return new Date().toISOString();
}

function projectConfig() {
  return loadConfig('translation-project-assignment', ConfigSchema);
}

export async function createTranslationProject(
  tenantId: string,
  actorId: string,
  data: {
    client_id: string;
    source_language: string;
    target_language: string;
    specialization: Specialization;
    word_count: number;
    deadline: string;
  }
): Promise<TranslationProject> {
  const project_id = crypto.randomUUID();

  return runCrudOperation({
    configName: 'translation-project-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'create',
    auditAction: 'data.created',
    auditResource: 'translation_project',
    meterEventType: 'api_call',
    actionFn: async () => {
      const config = projectConfig();

      if (!config.enabled) {
        throw new AppError(
          'Translation project assignment is disabled',
          ErrorCode.FORBIDDEN
        );
      }

      if (!config.supported_specializations.includes(data.specialization)) {
        throw new AppError(
          'Unsupported translation specialization',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!data.source_language.trim() || !data.target_language.trim()) {
        throw new AppError(
          'Source and target languages are required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (data.word_count <= 0) {
        throw new AppError(
          'Word count must be greater than zero',
          ErrorCode.BAD_REQUEST
        );
      }

      const timestamp = now();

      const project: TranslationProject = {
        project_id,
        client_id: data.client_id,
        source_language: data.source_language.trim(),
        target_language: data.target_language.trim(),
        specialization: data.specialization,
        word_count: data.word_count,
        deadline: data.deadline,
        status: 'intake',
        created_at: timestamp,
        updated_at: timestamp
      };

      store.set(tenantId + ':' + project_id, project);

      logger.info('Translation project created', {
        tenantId,
        projectId: project_id
      });

      return project;
    }
  });
}

export async function assignLinguist(
  tenantId: string,
  actorId: string,
  projectId: string,
  linguistId: string
): Promise<TranslationProject> {
  return runCrudOperation({
    configName: 'translation-project-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'translation_project',
    meterEventType: 'api_call',
    actionFn: async () => {
      const key = tenantId + ':' + projectId;
      const project = store.get(key);

      if (!project) {
        throw new AppError(
          'Translation project not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (!linguistId.trim()) {
        throw new AppError(
          'Linguist ID is required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (project.status === 'delivered') {
        throw new AppError(
          'Delivered projects cannot be reassigned',
          ErrorCode.CONFLICT
        );
      }

      project.assigned_linguist_id = linguistId.trim();
      project.status = 'assigned';
      project.updated_at = now();

      store.set(key, project);

      return project;
    }
  });
}

export function matchLinguist(
  tenantId: string,
  _actorId: string,
  sourceLanguage: string,
  targetLanguage: string,
  specialization: Specialization
): string[] {
  const matches: string[] = [];

  for (const [key, project] of store.entries()) {
    if (!key.startsWith(tenantId + ':')) {
      continue;
    }

    if (
      project.source_language === sourceLanguage &&
      project.target_language === targetLanguage &&
      project.specialization === specialization &&
      project.assigned_linguist_id
    ) {
      matches.push(project.assigned_linguist_id);
    }
  }

  return [...new Set(matches)];
}

export function calculateDeadlineFeasibility(
  wordCount: number,
  deadline: string,
  wordsPerDay = 2000
): boolean {
  if (wordCount <= 0 || wordsPerDay <= 0) {
    return false;
  }

  const deadlineTime = new Date(deadline).getTime();

  if (Number.isNaN(deadlineTime)) {
    return false;
  }

  const daysAvailable = Math.max(
    0,
    (deadlineTime - Date.now()) / 86400000
  );

  return Math.ceil(wordCount / wordsPerDay) <= Math.floor(daysAvailable) + 1;
}

export async function updateTranslationProjectStatus(
  tenantId: string,
  actorId: string,
  projectId: string,
  status: ProjectStatus
): Promise<TranslationProject> {
  return runCrudOperation({
    configName: 'translation-project-assignment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'translation_project',
    meterEventType: 'api_call',
    actionFn: async () => {
      const key = tenantId + ':' + projectId;
      const project = store.get(key);

      if (!project) {
        throw new AppError(
          'Translation project not found',
          ErrorCode.NOT_FOUND
        );
      }

      project.status = status;
      project.updated_at = now();

      store.set(key, project);

      return project;
    }
  });
}

export function getTranslationProject(
  tenantId: string,
  projectId: string
): TranslationProject | undefined {
  return store.get(tenantId + ':' + projectId);
}

export function __resetTranslationProjectStore(): void {
  store.clear();
}
