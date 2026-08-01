/**
 * platform/ai-gateway/src/index.ts
 */

import { AppError, ErrorCode } from '../../utils/src/index';
import { generateGroqText } from './providers/groq';
import { generateElevenLabsSpeech } from './providers/elevenlabs';
import { generateDidAvatarVideo } from './providers/did';
import type {
  TextGenerationRequest,
  TextGenerationResponse,
  SpeechGenerationRequest,
  SpeechGenerationResponse,
  AvatarVideoRequest,
  AvatarVideoResponse,
} from './types';

export async function generateText(
  request: TextGenerationRequest
): Promise<TextGenerationResponse> {
  switch (request.provider) {
    case 'groq':
      return generateGroqText(request);
    case 'anthropic':
    case 'openai':
      throw new AppError(
        `Text provider "${request.provider}" has no adapter built yet.`,
        ErrorCode.NOT_IMPLEMENTED
      );
    default:
      throw new AppError(`Unknown text provider.`, ErrorCode.BAD_REQUEST);
  }
}

export async function generateSpeech(
  request: SpeechGenerationRequest
): Promise<SpeechGenerationResponse> {
  switch (request.provider) {
    case 'elevenlabs':
      return generateElevenLabsSpeech(request);
    default:
      throw new AppError(`Unknown voice provider.`, ErrorCode.BAD_REQUEST);
  }
}

export async function generateAvatarVideo(
  request: AvatarVideoRequest
): Promise<AvatarVideoResponse> {
  switch (request.provider) {
    case 'did':
      return generateDidAvatarVideo(request);
    case 'heygen':
      throw new AppError(
        `Avatar provider "heygen" has no adapter built yet.`,
        ErrorCode.NOT_IMPLEMENTED
      );
    default:
      throw new AppError(`Unknown avatar provider.`, ErrorCode.BAD_REQUEST);
  }
}

export * from './types';
