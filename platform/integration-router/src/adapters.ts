import { z } from 'zod';
import {
  generateText,
  generateSpeech,
  generateAvatarVideo,
  type TextGenerationRequest,
  type SpeechGenerationRequest,
  type AvatarVideoRequest,
} from '@platform/ai-gateway';
import type { CapabilityContext, ProviderDefinition } from './types';

export const CAPABILITIES = {
  textGeneration: 'ai.text.generate',
  speechGeneration: 'ai.speech.generate',
  avatarVideo: 'ai.avatar.generate',
} as const;

export const capabilityDefinitions = {
  textGeneration: {
    id: CAPABILITIES.textGeneration,
    version: 'v1',
    description: 'Generate text using a configured AI text provider.',
    idempotency: 'optional',
    riskLevel: 2,
    externalImpact: false,
    requiresConfirmation: false,
    defaultTimeoutMs: 60_000,
    inputSchema: z.object({ model: z.string().min(1), messages: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string() })), maxTokens: z.number().int().positive().optional(), temperature: z.number().min(0).max(2).optional() }),
  },
  speechGeneration: {
    id: CAPABILITIES.speechGeneration,
    version: 'v1',
    description: 'Generate speech using a configured voice provider.',
    idempotency: 'optional',
    riskLevel: 2,
    externalImpact: false,
    requiresConfirmation: false,
    defaultTimeoutMs: 120_000,
    inputSchema: z.object({ voiceId: z.string().min(1), text: z.string().min(1), modelId: z.string().optional() }),
  },
  avatarVideo: {
    id: CAPABILITIES.avatarVideo,
    version: 'v1',
    description: 'Generate an avatar video job using a configured provider.',
    idempotency: 'required',
    riskLevel: 3,
    externalImpact: true,
    requiresConfirmation: false,
    defaultTimeoutMs: 120_000,
    inputSchema: z.object({ avatarId: z.string().min(1), text: z.string().optional(), audioUrl: z.string().url().optional() }),
  },
} as const;

export function groqProvider(): ProviderDefinition<TextGenerationRequest, unknown> {
  return {
    id: 'groq',
    displayName: 'Groq',
    capabilities: [CAPABILITIES.textGeneration],
    priority: 10,
    adapter: {
      invoke: async (_context, input) => {
        const output = await generateText({ ...input, provider: 'groq' });
        return {
          output,
          usage: output.usage ? {
            unit: 'tokens',
            dimensions: {
              inputTokens: output.usage.inputTokens,
              outputTokens: output.usage.outputTokens,
            },
          } : undefined,
        };
      },
    },
  };
}

export function elevenLabsProvider(): ProviderDefinition<SpeechGenerationRequest, unknown> {
  return {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    capabilities: [CAPABILITIES.speechGeneration],
    priority: 10,
    adapter: {
      invoke: async (_context, input) => ({
        output: await generateSpeech({ ...input, provider: 'elevenlabs' }),
      }),
    },
  };
}

export function didProvider(): ProviderDefinition<AvatarVideoRequest, unknown> {
  return {
    id: 'did',
    displayName: 'D-ID',
    capabilities: [CAPABILITIES.avatarVideo],
    priority: 10,
    adapter: {
      invoke: async (_context, input) => ({
        output: await generateAvatarVideo({ ...input, provider: 'did' }),
      }),
    },
  };
}
