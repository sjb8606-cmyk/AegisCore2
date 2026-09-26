import { AppError, ErrorCode } from '@platform/utils';

export function canonicalProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (/timeout|timed out|deadline/i.test(message)) {
    return new AppError(message, ErrorCode.TIMEOUT);
  }

  return new AppError(message, ErrorCode.SERVICE_UNAVAILABLE);
}

export function isRetryableError(error: unknown, retryableCodes: Set<string>): boolean {
  const normalized = canonicalProviderError(error);
  return retryableCodes.has(normalized.code);
}
