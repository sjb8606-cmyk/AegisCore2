/**
 * platform/ai-gateway/src/providers/groq.ts
 */

import { AppError, ErrorCode } from '../../../utils/src/index';
import { getApiKey } from '../keys';
import type { TextGenerationRequest, TextGenerationResponse } from '../types';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function generateGroqText(
  request: TextGenerationRequest
): Promise<TextGenerationResponse> {
  const apiKey = getApiKey('groq');

  const res = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new AppError(`Groq rate limit exceeded: ${body}`, ErrorCode.RATE_LIMITED);
    }
    throw new AppError(`Groq request failed (${res.status}): ${body}`, ErrorCode.SERVICE_UNAVAILABLE);
  }

  const data = await res.json() as any;
  const choice = data.choices?.[0];

  if (!choice) {
    throw new AppError('Groq response contained no choices.', ErrorCode.INTERNAL);
  }

  return {
    provider: 'groq',
    model: request.model,
    content: choice.message?.content ?? '',
    finishReason: choice.finish_reason ?? 'unknown',
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
      : undefined,
  };
}
