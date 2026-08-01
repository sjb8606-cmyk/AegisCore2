/**
 * platform/ai-gateway/src/keys.ts
 *
 * Centralized key resolution — v1 scope: org-level keys shared across all
 * apps (not per-tenant customer-supplied keys).
 */

import { AppError, ErrorCode } from '../../utils/src/index';
import type { TextProvider, VoiceProvider, AvatarProvider } from './types';

const ENV_KEYS: Record<string, string> = {
  groq: 'GROQ_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  did: 'DID_API_KEY',
  heygen: 'HEYGEN_API_KEY',
};

export function getApiKey(provider: TextProvider | VoiceProvider | AvatarProvider): string {
  const envVar = ENV_KEYS[provider];
  if (!envVar) {
    throw new AppError(`Unknown provider "${provider}" — no env var mapping configured.`, ErrorCode.BAD_REQUEST);
  }

  const key = process.env[envVar];
  if (!key) {
    throw new AppError(
      `Missing API key for provider "${provider}". Set ${envVar} in the environment.`,
      ErrorCode.SERVICE_UNAVAILABLE
    );
  }

  return key;
}
