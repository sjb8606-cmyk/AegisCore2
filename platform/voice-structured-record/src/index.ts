/**
 * platform/voice-structured-record
 *
 * Speak → transcribe → parse against schema → confirm → commit.
 * Transcribe + parse are injectable (mock defaults) for offline tests.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('voice-structured-record');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireConfirmFields: z.array(z.string()).default([]),
  autoConfirmIfComplete: z.boolean().default(false),
});

export type CaptureStatus =
  | 'captured'
  | 'transcribed'
  | 'parsed'
  | 'pending_confirm'
  | 'committed'
  | 'rejected';

export interface RecordTypeSchema {
  id: string;
  tenantId: string;
  name: string;
  fields: { key: string; type: 'string' | 'number' | 'boolean'; required: boolean }[];
  parseHints: string[];
}

export interface VoiceCapture {
  id: string;
  tenantId: string;
  schemaId: string;
  rawAudioRef: string | null;
  transcript: string | null;
  parsedFields: Record<string, unknown>;
  status: CaptureStatus;
  committedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

type TranscribeFn = (audioRef: string) => Promise<string>;
type ParseFn = (
  transcript: string,
  schema: RecordTypeSchema,
) => Promise<Record<string, unknown>>;

const schemas = new Map<string, RecordTypeSchema>();
const captures = new Map<string, VoiceCapture>();

let transcribeFn: TranscribeFn = async (ref) =>
  'mock transcript for ' + ref;
let parseFn: ParseFn = async (transcript, schema) => {
  // naive key:value scrape — real LLM adapter plugs in later
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    const re = new RegExp(f.key + '\\s*[:=]\\s*([^,;.]+)', 'i');
    const m = transcript.match(re);
    if (m) {
      const raw = m[1].trim();
      if (f.type === 'number') out[f.key] = Number(raw);
      else if (f.type === 'boolean') out[f.key] = /^(true|yes|1)$/i.test(raw);
      else out[f.key] = raw;
    }
  }
  return out;
};

export function __resetVoiceStructuredStore(): void {
  schemas.clear();
  captures.clear();
  transcribeFn = async (ref) => 'mock transcript for ' + ref;
  parseFn = async (transcript, schema) => {
    const out: Record<string, unknown> = {};
    for (const f of schema.fields) {
      const re = new RegExp(f.key + '\\s*[:=]\\s*([^,;.]+)', 'i');
      const m = transcript.match(re);
      if (m) {
        const raw = m[1].trim();
        if (f.type === 'number') out[f.key] = Number(raw);
        else if (f.type === 'boolean')
          out[f.key] = /^(true|yes|1)$/i.test(raw);
        else out[f.key] = raw;
      }
    }
    return out;
  };
}

export function setTranscribeFn(fn: TranscribeFn): void {
  transcribeFn = fn;
}
export function setParseFn(fn: ParseFn): void {
  parseFn = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('voice-structured-record', ConfigSchema);
}

export async function registerSchema(
  tenantId: string,
  actorId: string,
  input: {
    name: string;
    fields: { key: string; type: 'string' | 'number' | 'boolean'; required: boolean }[];
    parseHints?: string[];
  },
): Promise<RecordTypeSchema> {
  return runCrudOperation({
    configName: 'voice-structured-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.fields?.length) {
        throw new AppError('fields required', ErrorCode.BAD_REQUEST);
      }
      const schema: RecordTypeSchema = {
        id: crypto.randomUUID(),
        tenantId,
        name: input.name.trim(),
        fields: input.fields,
        parseHints: input.parseHints || [],
      };
      schemas.set(schema.id, schema);
      return schema;
    },
    auditAction: 'data.created',
    auditResource: 'voice_schema',
    meterEventType: 'api_call',
  });
}

export async function captureAudio(
  tenantId: string,
  actorId: string,
  input: { schemaId: string; rawAudioRef: string },
): Promise<VoiceCapture> {
  return runCrudOperation({
    configName: 'voice-structured-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const schema = schemas.get(input.schemaId);
      if (!schema || schema.tenantId !== tenantId) {
        throw new AppError('Schema not found', ErrorCode.NOT_FOUND);
      }
      if (!input.rawAudioRef?.trim()) {
        throw new AppError('rawAudioRef required', ErrorCode.BAD_REQUEST);
      }
      const now = new Date().toISOString();
      const cap: VoiceCapture = {
        id: crypto.randomUUID(),
        tenantId,
        schemaId: input.schemaId,
        rawAudioRef: input.rawAudioRef,
        transcript: null,
        parsedFields: {},
        status: 'captured',
        committedEntityId: null,
        createdAt: now,
        updatedAt: now,
      };
      captures.set(cap.id, cap);
      return cap;
    },
    auditAction: 'data.created',
    auditResource: 'voice_capture',
    meterEventType: 'api_call',
  });
}

export async function processCapture(
  tenantId: string,
  actorId: string,
  captureId: string,
): Promise<VoiceCapture> {
  return runCrudOperation({
    configName: 'voice-structured-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const cap = captures.get(captureId);
      if (!cap || cap.tenantId !== tenantId) {
        throw new AppError('Capture not found', ErrorCode.NOT_FOUND);
      }
      const schema = schemas.get(cap.schemaId);
      if (!schema) throw new AppError('Schema missing', ErrorCode.NOT_FOUND);

      const transcript = await transcribeFn(cap.rawAudioRef || '');
      cap.transcript = transcript;
      cap.status = 'transcribed';

      const parsed = await parseFn(transcript, schema);
      cap.parsedFields = parsed;
      cap.status = 'parsed';

      const missingRequired = schema.fields
        .filter((f) => f.required && (parsed[f.key] === undefined || parsed[f.key] === ''))
        .map((f) => f.key);

      const needConfirm =
        config.requireConfirmFields.length > 0 ||
        missingRequired.length > 0 ||
        !config.autoConfirmIfComplete;

      if (needConfirm && !config.autoConfirmIfComplete) {
        cap.status = 'pending_confirm';
      } else if (missingRequired.length === 0 && config.autoConfirmIfComplete) {
        cap.status = 'committed';
        cap.committedEntityId = crypto.randomUUID();
      } else {
        cap.status = 'pending_confirm';
      }
      cap.updatedAt = new Date().toISOString();
      captures.set(cap.id, cap);
      logger.info({ captureId, status: cap.status }, 'Voice capture processed');
      return cap;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'voice_capture',
    meterEventType: 'api_call',
  });
}

export async function confirmCapture(
  tenantId: string,
  actorId: string,
  captureId: string,
  input?: { overrides?: Record<string, unknown>; reject?: boolean },
): Promise<VoiceCapture> {
  return runCrudOperation({
    configName: 'voice-structured-record',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const cap = captures.get(captureId);
      if (!cap || cap.tenantId !== tenantId) {
        throw new AppError('Capture not found', ErrorCode.NOT_FOUND);
      }
      if (cap.status !== 'pending_confirm' && cap.status !== 'parsed') {
        throw new AppError(
          'Capture not awaiting confirm',
          ErrorCode.CONFLICT,
        );
      }
      if (input?.reject) {
        cap.status = 'rejected';
        cap.updatedAt = new Date().toISOString();
        captures.set(cap.id, cap);
        return cap;
      }
      if (input?.overrides) {
        cap.parsedFields = { ...cap.parsedFields, ...input.overrides };
      }
      const schema = schemas.get(cap.schemaId);
      if (schema) {
        for (const f of schema.fields) {
          if (
            f.required &&
            (cap.parsedFields[f.key] === undefined ||
              cap.parsedFields[f.key] === '')
          ) {
            throw new AppError(
              'missing required field: ' + f.key,
              ErrorCode.BAD_REQUEST,
            );
          }
        }
      }
      cap.status = 'committed';
      cap.committedEntityId = crypto.randomUUID();
      cap.updatedAt = new Date().toISOString();
      captures.set(cap.id, cap);
      return cap;
    },
    auditAction: 'data.updated',
    auditResource: 'voice_capture',
    meterEventType: 'api_call',
  });
}

export async function getCapture(
  tenantId: string,
  captureId: string,
): Promise<VoiceCapture | null> {
  const c = captures.get(captureId);
  if (!c || c.tenantId !== tenantId) return null;
  return c;
}
