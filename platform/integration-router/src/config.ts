import { loadConfig } from '@platform/utils';
import { z } from 'zod';
import type { RouterConfig } from './types';

const RouterConfigSchema = z.object({
  maxAttempts: z.number().int().positive(),
  retryableErrorCodes: z.array(z.string()).min(1),
  circuitFailureThreshold: z.number().int().positive(),
  circuitOpenMs: z.number().int().positive(),
  circuitSuccessThreshold: z.number().int().positive(),
});

export function loadRouterConfig(overrides?: Partial<RouterConfig>): RouterConfig {
  const base = loadConfig('integration-router', RouterConfigSchema);
  return { ...base, ...overrides };
}
