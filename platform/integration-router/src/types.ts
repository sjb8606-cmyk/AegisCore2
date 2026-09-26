import { z } from 'zod';

export type CapabilityVersion = `v${number}`;
export type IdempotencyMode = 'none' | 'optional' | 'required';

export interface CapabilityContext {
  tenantId: string;
  actorId: string;
  actorType?: 'user' | 'service' | 'system';
  correlationId?: string;
  traceId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  requestedProvider?: string;
  allowedProviders?: string[];
  preferredProviders?: string[];
  maxEstimatedCost?: number;
  region?: string;
  metadata?: Record<string, unknown>;
}

export interface CapabilityDefinition<I = unknown, O = unknown> {
  id: string;
  version: CapabilityVersion;
  description: string;
  inputSchema?: z.ZodType<I>;
  outputSchema?: z.ZodType<O>;
  idempotency: IdempotencyMode;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  externalImpact: boolean;
  requiresConfirmation: boolean;
  defaultTimeoutMs: number;
}

export interface ProviderUsage {
  unit?: string;
  quantity?: number;
  dimensions?: Record<string, number>;
  estimatedCost?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderResult<O = unknown> {
  output: O;
  usage?: ProviderUsage;
  metadata?: Record<string, unknown>;
}

export interface ProviderDefinition<I = unknown, O = unknown> {
  id: string;
  displayName: string;
  capabilities: string[];
  priority?: number;
  regions?: string[];
  estimatedCost?: number;
  supportsIdempotency?: boolean;
  adapter: ProviderAdapter<I, O>;
}

export interface ProviderAdapter<I = unknown, O = unknown> {
  invoke(context: CapabilityContext, input: I): Promise<ProviderResult<O>>;
  healthCheck?: (context?: Pick<CapabilityContext, 'tenantId' | 'signal'>) => Promise<boolean>;
}

export interface ProviderHealth {
  providerId: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedUntil: number | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}

export interface ProviderHealthStore {
  get(providerId: string): Promise<ProviderHealth | null>;
  save(state: ProviderHealth): Promise<void>;
}

export interface AtomicProviderHealthStore extends ProviderHealthStore {
  recordSuccess(providerId: string, successThreshold: number): Promise<ProviderHealth>;
  recordFailure(providerId: string, failureThreshold: number, openMs: number): Promise<ProviderHealth>;
}

export interface IdempotencyRecord {
  tenantId: string;
  key: string;
  capability: string;
  status: 'in_progress' | 'completed' | 'failed';
  providerId?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyStore {
  reserve(tenantId: string, key: string, capability: string): Promise<
    { kind: 'new'; record: IdempotencyRecord } |
    { kind: 'existing'; record: IdempotencyRecord }
  >;
  complete(tenantId: string, key: string, providerId: string, result: unknown): Promise<void>;
  fail(tenantId: string, key: string, providerId: string | undefined, error: { code: string; message: string }): Promise<void>;
}

export interface RouterConfig {
  maxAttempts: number;
  retryableErrorCodes: string[];
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  circuitSuccessThreshold: number;
}

export interface InvocationResult<O = unknown> {
  capability: string;
  capabilityVersion: CapabilityVersion;
  provider: string;
  output: O;
  usage?: ProviderUsage;
  attempts: Array<{
    provider: string;
    success: boolean;
    errorCode?: string;
  }>;
  correlationId: string;
}

export interface CapabilityRouter {
  invoke<I, O>(
    capabilityId: string,
    input: I,
    context: CapabilityContext
  ): Promise<InvocationResult<O>>;
}
