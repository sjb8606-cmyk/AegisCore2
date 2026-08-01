/**
 * platform/ai-gateway/tests/gateway.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText, generateSpeech, generateAvatarVideo } from '../src/index';
import { AppError, ErrorCode } from '../../utils/src/index';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  process.env.DID_API_KEY = 'test-did-key';
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('generateText — groq', () => {
  it('sends the correct request shape and parses a successful response', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Hello there!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await generateText({
      provider: 'groq',
      model: 'llama-4-scout',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-groq-key' }),
      })
    );
    expect(result.content).toBe('Hello there!');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('throws AppError with SERVICE_UNAVAILABLE if the API key is missing', async () => {
    delete process.env.GROQ_API_KEY;

    await expect(
      generateText({ provider: 'groq', model: 'llama-4-scout', messages: [] })
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE });
  });

  it('throws RATE_LIMITED on a 429 response', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    await expect(
      generateText({ provider: 'groq', model: 'llama-4-scout', messages: [] })
    ).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED });
  });

  it('throws SERVICE_UNAVAILABLE on other non-ok responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    });

    await expect(
      generateText({ provider: 'groq', model: 'llama-4-scout', messages: [] })
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE });
  });
});

describe('generateText — unimplemented providers', () => {
  it('throws NOT_IMPLEMENTED for anthropic (never fakes a response)', async () => {
    await expect(
      generateText({ provider: 'anthropic', model: 'claude', messages: [] })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
  });

  it('throws NOT_IMPLEMENTED for openai (never fakes a response)', async () => {
    await expect(
      generateText({ provider: 'openai', model: 'gpt', messages: [] })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
  });
});

describe('generateSpeech — elevenlabs', () => {
  it('sends the correct request and returns the audio buffer', async () => {
    const fakeAudio = new ArrayBuffer(8);
    (fetch as any).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakeAudio,
      headers: { get: () => 'audio/mpeg' },
    });

    const result = await generateSpeech({
      provider: 'elevenlabs',
      voiceId: 'voice-123',
      text: 'Hello world',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
      expect.objectContaining({
        headers: expect.objectContaining({ 'xi-api-key': 'test-elevenlabs-key' }),
      })
    );
    expect(result.audio).toBe(fakeAudio);
    expect(result.contentType).toBe('audio/mpeg');
  });
});

describe('generateAvatarVideo — unimplemented providers', () => {
  it('throws NOT_IMPLEMENTED for heygen (never fakes a response)', async () => {
    await expect(
      generateAvatarVideo({ provider: 'heygen', avatarId: 'a1', text: 'hi' })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
  });
});
