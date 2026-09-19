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

import { validateLlmOutput, analyzeSentiment } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('ai-sentiment', () => {
  it('throws NOT_IMPLEMENTED for validateLlmOutput (local fake removed)', async () => {
    await expect(validateLlmOutput('I love this product', {})).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('throws NOT_IMPLEMENTED for negative text too', async () => {
    await expect(validateLlmOutput('this is horrible and terrible', {})).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
