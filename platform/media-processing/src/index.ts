/**
 * platform/media-processing — local transforms (resize/crop/transcode mock).
 */
import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };
const logger = getLogger('media-processing');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxInputMb: z.number().default(50),
});

export type MediaOp = 'resize' | 'crop' | 'transcode' | 'thumbnail';

export interface MediaJob {
  id: string;
  tenantId: string;
  op: MediaOp;
  inputUrl: string;
  outputUrl: string;
  params: Record<string, unknown>;
  createdAt: string;
}

const jobs = new Map<string, MediaJob>();

export function __resetMediaProcessingStore(): void {
  jobs.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('media-processing', ConfigSchema);
}

export async function applyTransform(
  tenantId: string,
  actorId: string,
  input: {
    op: MediaOp;
    inputUrl: string;
    params?: Record<string, unknown>;
  },
): Promise<MediaJob> {
  return runCrudOperation({
    configName: 'media-processing',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      await loadCfg();
      if (!input.inputUrl?.trim()) {
        throw new AppError('inputUrl is required', ErrorCode.BAD_REQUEST);
      }
      const id = crypto.randomUUID();
      const job: MediaJob = {
        id,
        tenantId,
        op: input.op,
        inputUrl: input.inputUrl,
        outputUrl: `https://cdn.mock/processed/${id.slice(0, 8)}.bin`,
        params: input.params || {},
        createdAt: new Date().toISOString(),
      };
      jobs.set(id, job);
      logger.info({ op: input.op, id }, 'Media transform applied');
      return job;
    },
    auditAction: 'data.created',
    auditResource: 'media_job',
    meterEventType: 'api_call',
  });
}

export function getJob(id: string): MediaJob | null {
  return jobs.get(id) || null;
}
