import { describe, it, expect } from 'vitest';
import {
  listAvailableModels,
  validateSelection,
  buildFallbackOrder,
  type ModelListing,
  type UserModelSelection,
} from '../index';

const REGISTRY: ModelListing[] = [
  {
    provider: 'groq', modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B (Fast)',
    capabilityTags: ['fast'], costTier: 'free', avgLatencyMs: 400, minAccessTier: 'free', configured: true,
  },
  {
    provider: 'groq', modelId: 'llama-3.1-70b-versatile', displayName: 'Llama 3.1 70B (Reasoning)',
    capabilityTags: ['reasoning'], costTier: 'medium', avgLatencyMs: 1800, minAccessTier: 'paid', configured: true,
  },
  {
    provider: 'anthropic', modelId: 'claude-opus', displayName: 'Claude Opus (Premium)',
    capabilityTags: ['reasoning', 'creative'], costTier: 'high', avgLatencyMs: 3000, minAccessTier: 'premium', configured: false,
  },
];

describe('listAvailableModels', () => {
  it('a free-tier user must not see a paid-tier model', () => {
    const result = listAvailableModels(REGISTRY, 'free');
    expect(result.find((m) => m.minAccessTier === 'paid')).toBeUndefined();
  });

  it('a model with configured:false must never appear, regardless of the user tier', () => {
    const result = listAvailableModels(REGISTRY, 'premium');
    expect(result.find((m) => m.provider === 'anthropic')).toBeUndefined();
  });

  it('a paid-tier user sees both free and paid models', () => {
    const result = listAvailableModels(REGISTRY, 'paid');
    expect(result.some((m) => m.minAccessTier === 'free')).toBe(true);
    expect(result.some((m) => m.minAccessTier === 'paid')).toBe(true);
  });

  it('an unrecognized access tier sees nothing (fails closed, not open)', () => {
    const result = listAvailableModels(REGISTRY, 'not-a-real-tier');
    expect(result).toHaveLength(0);
  });
});

describe('validateSelection', () => {
  const validSelection: UserModelSelection = {
    userId: 'u1', tenantId: 't1', selectedProvider: 'groq', selectedModelId: 'llama-3.1-8b-instant', selectedAtMs: 0,
  };

  it('a selection matching a real, authorized, configured listing is valid', () => {
    expect(validateSelection(validSelection, REGISTRY, 'free')).toEqual({ valid: true });
  });

  it('a selection for a model not in the registry at all is invalid, with a clear reason', () => {
    const result = validateSelection(
      { ...validSelection, selectedProvider: 'openai', selectedModelId: 'gpt-fake' },
      REGISTRY, 'premium'
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in the real registry/);
  });

  it('a real model below the user access tier is invalid, with a clear reason', () => {
    const result = validateSelection(
      { ...validSelection, selectedProvider: 'groq', selectedModelId: 'llama-3.1-70b-versatile' },
      REGISTRY, 'free'
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/access tier/);
  });

  it('a real but unconfigured model is invalid, even for a premium user — never trust configured:false', () => {
    const result = validateSelection(
      { ...validSelection, selectedProvider: 'anthropic', selectedModelId: 'claude-opus' },
      REGISTRY, 'premium'
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no real provider API key/);
  });
});

describe('buildFallbackOrder', () => {
  const selection: UserModelSelection = {
    userId: 'u1', tenantId: 't1', selectedProvider: 'groq', selectedModelId: 'llama-3.1-8b-instant', selectedAtMs: 0,
  };

  it('puts the real user choice first', () => {
    expect(buildFallbackOrder(selection, REGISTRY, 'groq')[0]).toBe('groq');
  });

  it('does not duplicate the default when it matches the real user choice', () => {
    expect(buildFallbackOrder(selection, REGISTRY, 'groq')).toEqual(['groq']);
  });

  it('appends a real, different, configured default as fallback', () => {
    const otherSelection = { ...selection, selectedProvider: 'anthropic' };
    expect(buildFallbackOrder(otherSelection, REGISTRY, 'groq')).toEqual(['anthropic', 'groq']);
  });

  it('does not append a default that is not genuinely configured', () => {
    const result = buildFallbackOrder(selection, REGISTRY, 'anthropic');
    expect(result).toEqual(['groq']);
  });
});
