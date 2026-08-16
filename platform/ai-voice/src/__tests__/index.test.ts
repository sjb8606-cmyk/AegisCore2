import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { transcribeAudio, processVoiceCommand } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (withTenantQuery as any).mockResolvedValue([{ id: 'x' }]);
});

describe('ai-voice — real PII filtering, previously had none at all', () => {
  it('redacts a phone number from a transcript before storing it', async () => {
    await transcribeAudio(TENANT_ID, {
      source_type: 'call',
      audio_url: 'https://example.com/call.mp3',
      transcript: 'Customer said call me back at 555-123-4567 please.',
    });

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO voice_transcriptions'),
    );
    const storedTranscript = insertCall[1][4];
    expect(storedTranscript).toContain('[PHONE REDACTED]');
    expect(storedTranscript).not.toContain('555-123-4567');
  });

  it('redacts an email from a voice command before storing it', async () => {
    await processVoiceCommand(TENANT_ID, { raw_text: 'search for jane@example.com', confidence: 0.9 }, USER_ID);

    const insertCall = (withTenantQuery as any).mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO voice_commands'),
    );
    const storedText = insertCall[1][2];
    expect(storedText).toContain('[EMAIL REDACTED]');
    expect(storedText).not.toContain('jane@example.com');
  });

  it('still blocks a genuinely dangerous command (checked against the REAL text, before redaction)', async () => {
    await expect(
      processVoiceCommand(TENANT_ID, { raw_text: 'drop table users', confidence: 0.9 }, USER_ID),
    ).rejects.toThrow('AI Safety Guard');
  });
});
