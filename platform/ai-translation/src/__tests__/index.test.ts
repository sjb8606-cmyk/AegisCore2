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

describe('ai-translation', () => {
  it('throws NOT_IMPLEMENTED for validateLlmOutput (local fake removed)', async () => {
    await expect(validateLlmOutput('Hello world', {})).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('throws NOT_IMPLEMENTED even with schema option', async () => {
    await expect(
      validateLlmOutput(JSON.stringify({ company_name: 'Test' }), { schema: { translated: 'object' } })
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
