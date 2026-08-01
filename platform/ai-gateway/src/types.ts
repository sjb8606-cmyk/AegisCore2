/**
 * platform/ai-gateway/src/types.ts
 */

export type TextProvider = 'groq' | 'anthropic' | 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TextGenerationRequest {
  provider: TextProvider;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface TextGenerationResponse {
  provider: TextProvider;
  model: string;
  content: string;
  finishReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export type VoiceProvider = 'elevenlabs';

export interface SpeechGenerationRequest {
  provider: VoiceProvider;
  voiceId: string;
  text: string;
  modelId?: string;
}

export interface SpeechGenerationResponse {
  provider: VoiceProvider;
  audio: ArrayBuffer;
  contentType: string;
}

export type AvatarProvider = 'did' | 'heygen';

export interface AvatarVideoRequest {
  provider: AvatarProvider;
  avatarId: string;
  text?: string;
  audioUrl?: string;
}

export interface AvatarVideoResponse {
  provider: AvatarProvider;
  jobId: string;
  status: 'processing' | 'done' | 'error';
  videoUrl?: string;
}
