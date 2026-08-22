/**
 * platform/reference-id
 *
 * Human-readable reference IDs: PREFIX-DATE-SEQ or PREFIX-DATE-RAND.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('reference-id');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPrefix: z.string().default('REF'),
  format: z.enum(['sequential', 'random']).default('sequential'),
  dateFormat: z.enum(['YYYYMMDD', 'YYMMDD', 'none']).default('YYYYMMDD'),
  seqPad: z.number().int().positive().default(4),
  randomLen: z.number().int().positive().default(6),
  separator: z.string().default('-'),
});

/** key: tenant:prefix:dateKey → counter */
const sequences = new Map<string, number>();
const issued = new Set<string>(); // uniqueness guard

export function __resetReferenceIdStore(): void {
  sequences.clear();
  issued.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('reference-id', ConfigSchema);
}

export function formatDateKey(
  date: Date,
  dateFormat: 'YYYYMMDD' | 'YYMMDD' | 'none',
): string {
  if (dateFormat === 'none') return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  if (dateFormat === 'YYMMDD') return String(y).slice(2) + m + d;
  return String(y) + m + d;
}

export function randomSuffix(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function buildId(
  prefix: string,
  dateKey: string,
  suffix: string,
  separator: string,
): string {
  const parts = [prefix.toUpperCase()];
  if (dateKey) parts.push(dateKey);
  parts.push(suffix);
  return parts.join(separator);
}

export async function generate(
  tenantId: string,
  actorId: string,
  input?: {
    prefix?: string;
    format?: 'sequential' | 'random';
    context?: string;
  },
): Promise<{ id: string; prefix: string; dateKey: string }> {
  return runCrudOperation({
    configName: 'reference-id',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const prefix = (input?.prefix || config.defaultPrefix).toUpperCase();
      if (!/^[A-Z0-9]{1,12}$/.test(prefix)) {
        throw new AppError(
          'prefix must be 1-12 alphanumeric chars',
          ErrorCode.BAD_REQUEST,
        );
      }
      const format = input?.format || config.format;
      const dateKey = formatDateKey(new Date(), config.dateFormat);
      const seqKey = tenantId + ':' + prefix + ':' + (dateKey || 'none');

      let suffix: string;
      if (format === 'sequential') {
        const next = (sequences.get(seqKey) || 0) + 1;
        sequences.set(seqKey, next);
        suffix = String(next).padStart(config.seqPad, '0');
      } else {
        suffix = randomSuffix(config.randomLen);
      }

      let id = buildId(prefix, dateKey, suffix, config.separator);
      // Extremely unlikely collision for random; still guard
      let attempts = 0;
      while (issued.has(tenantId + ':' + id) && attempts < 5) {
        if (format === 'random') {
          suffix = randomSuffix(config.randomLen);
          id = buildId(prefix, dateKey, suffix, config.separator);
        } else {
          const next = (sequences.get(seqKey) || 0) + 1;
          sequences.set(seqKey, next);
          suffix = String(next).padStart(config.seqPad, '0');
          id = buildId(prefix, dateKey, suffix, config.separator);
        }
        attempts++;
      }
      if (issued.has(tenantId + ':' + id)) {
        throw new AppError('Could not allocate unique id', ErrorCode.CONFLICT);
      }
      issued.add(tenantId + ':' + id);
      logger.info({ id, prefix, context: input?.context }, 'Reference id issued');
      return { id, prefix, dateKey };
    },
    auditAction: 'data.created',
    auditResource: 'reference_id',
    meterEventType: 'api_call',
  });
}

export async function peekNextSequential(
  tenantId: string,
  prefix: string,
  dateKey?: string,
): Promise<number> {
  const key =
    tenantId +
    ':' +
    prefix.toUpperCase() +
    ':' +
    (dateKey !== undefined
      ? dateKey
      : formatDateKey(new Date(), 'YYYYMMDD'));
  return (sequences.get(key) || 0) + 1;
}

export function isIssued(tenantId: string, id: string): boolean {
  return issued.has(tenantId + ':' + id);
}
