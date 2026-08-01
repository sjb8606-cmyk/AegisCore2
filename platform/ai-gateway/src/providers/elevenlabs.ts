/**
 * platform/ai-gateway/src/providers/elevenlabs.ts
 */

import { AppError, ErrorCode } from '../../../utils/src/index';
import { getApiKey } from '../keys';
import type { SpeechGenerationRequest, SpeechGenerationResponse } from '../types';

function elevenLabsUrl(voiceId: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
}

export async function generateElevenLabsSpeech(
  request: SpeechGenerationRequest
): Promise<SpeechGenerationResponse> {
  const apiKey = getApiKey('elevenlabs');

  const res = await fetch(elevenLabsUrl(request.voiceId), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: request.text,
      model_id: request.modelId ?? 'eleven_multilingual_v2',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new AppError(`ElevenLabs rate limit exceeded: ${body}`, ErrorCode.RATE_LIMITED);
    }
    throw new AppError(`ElevenLabs request failed (${res.status}): ${body}`, ErrorCode.SERVICE_UNAVAILABLE);
  }

  const audio = await res.arrayBuffer();

  return {
    provider: 'elevenlabs',
    audio,
    contentType: res.headers.get('content-type') ?? 'audio/mpeg',
  };
}
