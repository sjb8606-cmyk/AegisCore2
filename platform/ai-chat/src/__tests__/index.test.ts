import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
  withTenantTransaction: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/ai-safety', () => ({
  validateLlmOutput: vi.fn(),
}));

vi.mock('@platform/ai-gateway', () => ({
  generateText: vi.fn(),
}));

import { sendMessage } from '../index';
import { withTenantQuery, withTenantTransaction } from '@platform/tenancy';
import { recordUsage } from '@platform/metering';
import { validateLlmOutput } from '@platform/ai-safety';
import { generateText } from '@platform/ai-gateway';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CONVO_ID = '33333333-3333-3333-3333-333333333333';

const mockTransactionClient = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  (validateLlmOutput as any).mockResolvedValue({ valid: true, violations: [], filtered: false });
  (withTenantTransaction as any).mockImplementation((fn: any) => fn(mockTransactionClient));
  (withTenantQuery as any).mockResolvedValue([]);
});

describe('sendMessage — real LLM wiring', () => {
  it('calls generateText with the "groq" provider — the only one ai-gateway actually has an adapter for', async () => {
    (generateText as any).mockResolvedValue({
      provider: 'groq', model: 'llama-4-scout-17b-16e-instruct',
      content: 'Here is a real, model-generated answer.', finishReason: 'stop',
    });

    const result = await sendMessage(TENANT_ID, CONVO_ID, 'What is our refund policy?', USER_ID);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'groq' }),
    );
    expect(result.content).toBe('Here is a real, model-generated answer.');
    expect(result.content).not.toContain('Oracle AI');
  });

  it('blocks unsafe input before ever calling the real LLM', async () => {
    (validateLlmOutput as any).mockResolvedValue({ valid: false, violations: [{ type: 'pii_detected' }], filtered: true });

    await expect(sendMessage(TENANT_ID, CONVO_ID, 'my SSN is 123-45-6789', USER_ID)).rejects.toThrow(
      'Unsafe input blocked by AI Safety Gate',
    );

    expect(generateText).not.toHaveBeenCalled();
  });

  it('includes real prior conversation history, in chronological order, in the model call', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { role: 'assistant', content: 'Latest reply' },
      { role: 'user', content: 'Latest question' },
      { role: 'assistant', content: 'Earlier reply' },
      { role: 'user', content: 'Earlier question' },
    ]);
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await sendMessage(TENANT_ID, CONVO_ID, 'newest message', USER_ID);

    const callArgs = (generateText as any).mock.calls[0][0];
    const historyMessages = callArgs.messages.slice(1, -1);
    expect(historyMessages[0].content).toBe('Earlier question');
    expect(historyMessages[3].content).toBe('Latest reply');
  });

  it('saves both the user message and the real assistant reply atomically', async () => {
    (generateText as any).mockResolvedValue({ content: 'a genuine reply', provider: 'groq', model: 'x', finishReason: 'stop' });

    await sendMessage(TENANT_ID, CONVO_ID, 'a real question', USER_ID);

    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    const userInsert = mockTransactionClient.query.mock.calls.find((c: any[]) => c[1]?.[2] === 'user');
    const assistantInsert = mockTransactionClient.query.mock.calls.find((c: any[]) => c[1]?.[2] === 'assistant');
    expect(userInsert[1]).toContain('a real question');
    expect(assistantInsert[1]).toContain('a genuine reply');
  });

  it('still meters usage exactly once per real message sent', async () => {
    (generateText as any).mockResolvedValue({ content: 'ok', provider: 'groq', model: 'x', finishReason: 'stop' });

    await sendMessage(TENANT_ID, CONVO_ID, 'test', USER_ID);

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, eventType: 'api_call' }),
    );
  });
});
