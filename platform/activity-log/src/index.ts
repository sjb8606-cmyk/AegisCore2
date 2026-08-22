/**
 * platform/activity-log
 *
 * Structured "work performed" tied to a job: notes, measurements, photos, checklist.
 * Checklist confirm can integrate with hitl-confirm-gate later; here we validate inline.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('activity-log');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  jobTypeProfiles: z
    .array(
      z.object({
        jobType: z.string(),
        measurementFields: z
          .array(
            z.object({
              key: z.string(),
              unit: z.string().optional(),
              required: z.boolean().default(false),
            }),
          )
          .default([]),
        checklistItems: z.array(z.string()).default([]),
        requiredPhotoCount: z.number().int().nonnegative().default(0),
      }),
    )
    .default([
      {
        jobType: 'service',
        measurementFields: [
          { key: 'pressure_psi', unit: 'psi', required: false },
          { key: 'temp_c', unit: 'C', required: false },
        ],
        checklistItems: ['Safety PPE', 'Area cleared'],
        requiredPhotoCount: 0,
      },
    ]),
});

export interface Measurement {
  key: string;
  value: number | string;
  unit?: string;
}

export interface ChecklistResult {
  item: string;
  passed: boolean;
  note?: string;
}

export interface ActivityLogEntry {
  id: string;
  tenantId: string;
  jobId: string;
  jobType: string;
  notes: string;
  measurements: Measurement[];
  photos: string[];
  checklistResults: ChecklistResult[];
  loggedBy: string;
  loggedAt: string;
}

const logs = new Map<string, ActivityLogEntry>();

export function __resetActivityLogStore(): void {
  logs.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('activity-log', ConfigSchema);
}

function profileFor(
  config: z.infer<typeof ConfigSchema>,
  jobType: string,
) {
  return (
    config.jobTypeProfiles.find((p) => p.jobType === jobType) ||
    config.jobTypeProfiles[0]
  );
}

export async function createLog(
  tenantId: string,
  actorId: string,
  input: {
    jobId: string;
    jobType: string;
    notes?: string;
    measurements?: Measurement[];
    photos?: string[];
    checklistResults?: ChecklistResult[];
  },
): Promise<ActivityLogEntry> {
  return runCrudOperation({
    configName: 'activity-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.jobId?.trim()) {
        throw new AppError('jobId is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.jobType?.trim()) {
        throw new AppError('jobType is required', ErrorCode.BAD_REQUEST);
      }
      const profile = profileFor(config, input.jobType);
      const measurements = input.measurements || [];
      const photos = input.photos || [];
      const checklistResults = input.checklistResults || [];

      // required measurements
      for (const mf of profile.measurementFields) {
        if (mf.required) {
          const found = measurements.find((m) => m.key === mf.key);
          if (!found) {
            throw new AppError(
              'missing measurement: ' + mf.key,
              ErrorCode.BAD_REQUEST,
            );
          }
        }
      }

      // photos
      if (photos.length < profile.requiredPhotoCount) {
        throw new AppError(
          'need at least ' + profile.requiredPhotoCount + ' photos',
          ErrorCode.BAD_REQUEST,
        );
      }

      // checklist: every profile item must appear and pass if present in profile
      if (profile.checklistItems.length) {
        for (const item of profile.checklistItems) {
          const r = checklistResults.find((c) => c.item === item);
          if (!r) {
            throw new AppError(
              'missing checklist item: ' + item,
              ErrorCode.BAD_REQUEST,
            );
          }
          if (!r.passed) {
            throw new AppError(
              'checklist failed: ' + item,
              ErrorCode.BAD_REQUEST,
            );
          }
        }
      }

      const entry: ActivityLogEntry = {
        id: crypto.randomUUID(),
        tenantId,
        jobId: input.jobId,
        jobType: input.jobType,
        notes: (input.notes || '').trim(),
        measurements,
        photos,
        checklistResults,
        loggedBy: actorId,
        loggedAt: new Date().toISOString(),
      };
      logs.set(entry.id, entry);
      logger.info({ logId: entry.id, jobId: input.jobId }, 'Activity logged');
      return entry;
    },
    auditAction: 'data.created',
    auditResource: 'activity_log',
    meterEventType: 'api_call',
  });
}

export async function listByJob(
  tenantId: string,
  jobId: string,
): Promise<ActivityLogEntry[]> {
  return [...logs.values()]
    .filter((l) => l.tenantId === tenantId && l.jobId === jobId)
    .sort(
      (a, b) =>
        new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
    );
}

export async function getLog(
  tenantId: string,
  logId: string,
): Promise<ActivityLogEntry | null> {
  const l = logs.get(logId);
  if (!l || l.tenantId !== tenantId) return null;
  return l;
}

export async function attachPhoto(
  tenantId: string,
  actorId: string,
  logId: string,
  photoRef: string,
): Promise<ActivityLogEntry> {
  return runCrudOperation({
    configName: 'activity-log',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entry = logs.get(logId);
      if (!entry || entry.tenantId !== tenantId) {
        throw new AppError('Log not found', ErrorCode.NOT_FOUND);
      }
      if (!photoRef?.trim()) {
        throw new AppError('photoRef required', ErrorCode.BAD_REQUEST);
      }
      entry.photos = entry.photos.concat([photoRef.trim()]);
      logs.set(logId, entry);
      return entry;
    },
    auditAction: 'data.updated',
    auditResource: 'activity_log',
    meterEventType: 'api_call',
  });
}
