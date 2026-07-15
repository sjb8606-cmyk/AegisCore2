/**
 * platform/queues/src/retry.ts
 *
 * Exponential backoff with jitter for reliable retries.
 * Used by SQS client and other network operations.
 */

import { getLogger } from '@platform/observability';

const logger = getLogger('queues:retry');

export interface RetryOptions {
  maxAttempts?:  number;
  baseDelayMs?:  number;
  maxDelayMs?:   number;
  jitter?:       boolean;
  shouldRetry?:  (err: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts:  5,
  baseDelayMs:  100,
  maxDelayMs:   30_000,
  jitter:       true,
  shouldRetry:  isRetryable,
};

/**
 * withExponentialBackoff — retry an async operation with backoff + jitter.
 */
export async function withExponentialBackoff<T>(
  fn:      () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      if (attempt === opts.maxAttempts || !opts.shouldRetry(err)) {
        logger.error({ err, attempt, maxAttempts: opts.maxAttempts }, 'Retry exhausted');
        throw err;
      }

      const delay = calculateDelay(attempt, opts);
      logger.warn({ err, attempt, delayMs: delay }, 'Retrying after backoff');
      await sleep(delay);
    }
  }

  throw lastErr;
}

// ── Helpers ───────────────────────────────────────────────────

function calculateDelay(attempt: number, opts: Required<RetryOptions>): number {
  // Exponential: baseDelay * 2^(attempt-1)
  const exponential = opts.baseDelayMs * Math.pow(2, attempt - 1);
  const capped      = Math.min(exponential, opts.maxDelayMs);

  if (!opts.jitter) return capped;

  // Full jitter: random between 0 and capped
  return Math.random() * capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default retry predicate — retries on transient network/AWS errors.
 */
function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;

  // AWS SDK error codes that are retryable
  const retryableCodes = new Set([
    'RequestThrottled',
    'ThrottlingException',
    'ProvisionedThroughputExceededException',
    'ServiceUnavailable',
    'InternalFailure',
    'InternalError',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
  ]);

  const code = String(e.code || e.Code || e.name || '');
  if (retryableCodes.has(code)) return true;

  // HTTP 429, 503, 504
  const status = Number(e.$metadata?.httpStatusCode || e.statusCode || e.status || 0);
  return status === 429 || status === 503 || status === 504;
}
