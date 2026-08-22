import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      requireConfirmFields: [],
      autoConfirmIfComplete: false,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  registerSchema,
  captureAudio,
  processCapture,
  confirmCapture,
  setTranscribeFn,
  setParseFn,
  __resetVoiceStructuredStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('voice-structured-record', () => {
  beforeEach(() => {
    __resetVoiceStructuredStore();
    vi.clearAllMocks();
  });

  it('captures, parses, and confirms', async () => {
    const schema = await registerSchema(tenantId, actorId, {
      name: 'catch-log',
      fields: [
        { key: 'species', type: 'string', required: true },
        { key: 'weight_kg', type: 'number', required: true },
      ],
    });

    setTranscribeFn(async () => 'species: cod, weight_kg: 12.5');
    setParseFn(async () => ({ species: 'cod', weight_kg: 12.5 }));

    const cap = await captureAudio(tenantId, actorId, {
      schemaId: schema.id,
      rawAudioRef: 's3://audio/1.wav',
    });
    const processed = await processCapture(tenantId, actorId, cap.id);
    expect(processed.status).toBe('pending_confirm');
    expect(processed.parsedFields.species).toBe('cod');

    const committed = await confirmCapture(tenantId, actorId, cap.id);
    expect(committed.status).toBe('committed');
    expect(committed.committedEntityId).toBeTruthy();
  });

  it('rejects incomplete confirm', async () => {
    const schema = await registerSchema(tenantId, actorId, {
      name: 'inspection',
      fields: [{ key: 'site', type: 'string', required: true }],
    });
    setTranscribeFn(async () => 'nothing useful');
    setParseFn(async () => ({}));

    const cap = await captureAudio(tenantId, actorId, {
      schemaId: schema.id,
      rawAudioRef: 's3://audio/2.wav',
    });
    await processCapture(tenantId, actorId, cap.id);
    await expect(
      confirmCapture(tenantId, actorId, cap.id),
    ).rejects.toThrow(/missing required/i);
  });

  it('can reject a capture', async () => {
    const schema = await registerSchema(tenantId, actorId, {
      name: 'note',
      fields: [{ key: 'text', type: 'string', required: false }],
    });
    setParseFn(async () => ({ text: 'hi' }));
    const cap = await captureAudio(tenantId, actorId, {
      schemaId: schema.id,
      rawAudioRef: 's3://a.wav',
    });
    await processCapture(tenantId, actorId, cap.id);
    const rejected = await confirmCapture(tenantId, actorId, cap.id, {
      reject: true,
    });
    expect(rejected.status).toBe('rejected');
  });
});
