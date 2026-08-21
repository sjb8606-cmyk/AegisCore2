import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      hardCategories: [
        'medical',
        'financial_advice',
        'therapy',
        'legal_advice',
        'harm_facilitation',
      ],
      softCategories: ['relationship_advice', 'parenting'],
      layer2TriggersOnRepeat: true,
    }),
  };
});

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  scanBoundary,
  classifyMessage,
  __resetPersonaSafetyStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = 'user-1';
const personaId = 'persona-scout-guide';
const sessionId = 'sess-1';

describe('persona-safety', () => {
  beforeEach(() => {
    __resetPersonaSafetyStore();
    vi.clearAllMocks();
  });

  it('classifies medical as hard', () => {
    const hit = classifyMessage(
      'Please diagnose my rash and prescribe something',
      ['medical'],
      [],
    );
    expect(hit?.category).toBe('medical');
    expect(hit?.severity).toBe('hard');
  });

  it('Layer 2 on hard category', async () => {
    const result = await scanBoundary(tenantId, userId, {
      userMessage: 'Can you diagnose my symptoms?',
      userId,
      personaId,
      sessionId,
    });
    expect(result.safe).toBe(false);
    expect(result.layer).toBe(2);
    expect(result.response).toBeTruthy();
    expect(result.veridactReceipt).toBeTruthy();
  });

  it('soft category first hit is layer 1 pass-through', async () => {
    const result = await scanBoundary(tenantId, userId, {
      userMessage: 'Should I break up with them?',
      userId,
      personaId,
      sessionId,
    });
    expect(result.layer).toBe(1);
    expect(result.safe).toBe(true);
  });

  it('soft category repeat triggers layer 2', async () => {
    await scanBoundary(tenantId, userId, {
      userMessage: 'Should I break up with them?',
      userId,
      personaId,
      sessionId,
    });
    const second = await scanBoundary(tenantId, userId, {
      userMessage: 'Should I break up with them for real?',
      userId,
      personaId,
      sessionId,
    });
    expect(second.layer).toBe(2);
    expect(second.safe).toBe(false);
  });
});
