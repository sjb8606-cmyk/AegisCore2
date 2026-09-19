import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AppError: class AppError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = 'AppError';
        this.code = code;
      }
    },
  };
});

import { validateLlmOutput } from '../index';

describe('ai-email', () => {
  it('throws NOT_IMPLEMENTED for validateLlmOutput (local fake removed)', async () => {
    await expect(validateLlmOutput('billing refund request', {})).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('throws NOT_IMPLEMENTED even with schema option', async () => {
    await expect(
      validateLlmOutput('any text', { schema: { draft: 'string' } })
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
