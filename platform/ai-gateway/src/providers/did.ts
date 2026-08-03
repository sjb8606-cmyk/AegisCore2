/**
 * platform/ai-gateway/src/providers/did.ts
 *
 * NOTE: verify D-ID's exact auth scheme and field names against
 * https://docs.d-id.com before the first real call — this was built to
 * D-ID's general documented pattern, not independently re-verified the
 * way Groq's shape was.
 */

import { AppError, ErrorCode } from '../../../utils/src/index';
import { getApiKey } from '../keys';
import type { AvatarVideoRequest, AvatarVideoResponse } from '../types';

const DID_TALKS_URL = 'https://api.d-id.com/talks';

export async function generateDidAvatarVideo(
  request: AvatarVideoRequest
): Promise<AvatarVideoResponse> {
  const apiKey = getApiKey('did');
  const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');

  const res = await fetch(DID_TALKS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_url: request.avatarId,
      script: request.text
        ? { type: 'text', input: request.text }
        : { type: 'audio', audio_url: request.audioUrl },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError(`D-ID request failed (${res.status}): ${body}`, ErrorCode.SERVICE_UNAVAILABLE);
  }

  const data = await res.json() as any;

  return {
    provider: 'did',
    jobId: data.id,
    status: 'processing',
  };
}
