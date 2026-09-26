import { randomUUID } from 'crypto';
import { emit } from '@platform/audit';
import { recordUsage } from '@platform/metering';
import { AppError, ErrorCode } from '@platform/utils';
import type {
  CapabilityContext, CapabilityDefinition, CapabilityRouter, InvocationResult, ProviderDefinition, RouterConfig,
} from './types';
import { CapabilityRegistry, ProviderRegistry } from './registry';
import { CircuitBreaker, InMemoryProviderHealthStore } from './health';
import { InMemoryIdempotencyStore } from './idempotency';
import { canonicalProviderError, isRetryableError } from './errors';
import { loadRouterConfig } from './config';

const DEFAULT_CONFIG: RouterConfig = {
  maxAttempts: 3,
  retryableErrorCodes: [ErrorCode.RATE_LIMITED, ErrorCode.SERVICE_UNAVAILABLE, ErrorCode.TIMEOUT],
  circuitFailureThreshold: 5,
  circuitOpenMs: 30_000,
  circuitSuccessThreshold: 2,
};

export interface IntegrationRouterOptions {
  config?: Partial<RouterConfig>;
  capabilities?: CapabilityRegistry;
  providers?: ProviderRegistry;
  healthStore?: import('./types').ProviderHealthStore;
  idempotencyStore?: import('./types').IdempotencyStore;
}

export class IntegrationRouter implements CapabilityRouter {
  readonly capabilities: CapabilityRegistry;
  readonly providers: ProviderRegistry;
  readonly circuitBreaker: CircuitBreaker;
  private readonly idempotency: import('./types').IdempotencyStore;
  private readonly config: RouterConfig;

  constructor(options: IntegrationRouterOptions = {}) {
    this.config = loadRouterConfig({ ...DEFAULT_CONFIG, ...(options.config ?? {}) });
    this.capabilities = options.capabilities ?? new CapabilityRegistry();
    this.providers = options.providers ?? new ProviderRegistry();
    this.circuitBreaker = new CircuitBreaker(
      options.healthStore ?? new InMemoryProviderHealthStore(),
      this.config.circuitFailureThreshold,
      this.config.circuitOpenMs,
      this.config.circuitSuccessThreshold,
    );
    this.idempotency = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  async invoke<I, O>(capabilityId: string, input: I, context: CapabilityContext): Promise<InvocationResult<O>> {
    if (!context.tenantId || !context.actorId) {
      throw new AppError('tenantId and actorId are required', ErrorCode.UNAUTHORIZED);
    }

    const definition = this.capabilities.get(capabilityId);
    if (!definition) throw new AppError(`Unknown capability: ${capabilityId}`, ErrorCode.NOT_FOUND);

    if (definition.inputSchema) {
      const parsed = definition.inputSchema.safeParse(input);
      if (!parsed.success) throw new AppError('Capability input validation failed', ErrorCode.UNPROCESSABLE, parsed.error.flatten());
    }

    if (definition.idempotency === 'required' && !context.idempotencyKey) {
      throw new AppError(`Capability ${capabilityId} requires an idempotency key`, ErrorCode.CONFLICT);
    }

    const correlationId = context.correlationId ?? randomUUID();
    const idempotencyKey = context.idempotencyKey;
    let reserved = false;

    if (idempotencyKey) {
      const reservation = await this.idempotency.reserve(context.tenantId, idempotencyKey, capabilityId);
      if (reservation.kind === 'existing') {
        const record = reservation.record;
        if (record.capability !== capabilityId) {
          throw new AppError('Idempotency key is already bound to another capability', ErrorCode.CONFLICT);
        }
        if (record.status === 'completed') {
          return {
            capability: capabilityId,
            capabilityVersion: definition.version,
            provider: record.providerId ?? 'replayed',
            output: record.result as O,
            attempts: [],
            correlationId,
          };
        }
        if (record.status === 'failed') {
          throw new AppError(record.error?.message ?? 'Previous invocation failed', record.error?.code as ErrorCode ?? ErrorCode.SERVICE_UNAVAILABLE);
        }
        throw new AppError('An invocation with this idempotency key is already in progress', ErrorCode.CONFLICT);
      }
      reserved = true;
    }

    const candidates = this.selectProviders(definition, context);
    if (candidates.length === 0) {
      if (reserved) await this.idempotency.fail(context.tenantId, idempotencyKey!, undefined, { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'No healthy provider available' });
      throw new AppError('No provider is available for this capability', ErrorCode.SERVICE_UNAVAILABLE);
    }

    const attempts: InvocationResult['attempts'] = [];
    let lastError: AppError | null = null;
    const maxAttempts = Math.min(this.config.maxAttempts, candidates.length);

    for (const provider of candidates.slice(0, maxAttempts)) {
      if (await this.circuitBreaker.isOpen(provider.id)) continue;
      attempts.push({ provider: provider.id, success: false });

      try {
        const result = await this.invokeWithDeadline(provider, context, input, definition.defaultTimeoutMs);
        if (definition.outputSchema) {
          const parsed = definition.outputSchema.safeParse(result.output);
          if (!parsed.success) {
            throw new AppError('Provider returned invalid capability output', ErrorCode.INTERNAL, parsed.error.flatten());
          }
        }

        await this.circuitBreaker.recordSuccess(provider.id);
        attempts[attempts.length - 1].success = true;

        if (reserved) await this.idempotency.complete(context.tenantId, idempotencyKey!, provider.id, result.output);
        await this.emitAudit(context, capabilityId, provider, true, correlationId, result);
        await this.emitMetering(context, capabilityId, provider, result);

        return {
          capability: capabilityId,
          capabilityVersion: definition.version,
          provider: provider.id,
          output: result.output as O,
          usage: result.usage,
          attempts,
          correlationId,
        };
      } catch (error) {
        const normalized = canonicalProviderError(error);
        attempts[attempts.length - 1].errorCode = normalized.code;
        lastError = normalized;
        await this.circuitBreaker.recordFailure(provider.id);

        if (!isRetryableError(normalized, new Set(this.config.retryableErrorCodes))) break;
      }
    }

    if (reserved) {
      await this.idempotency.fail(
        context.tenantId,
        idempotencyKey!,
        attempts.find((a) => a.errorCode)?.provider,
        { code: lastError?.code ?? ErrorCode.SERVICE_UNAVAILABLE, message: lastError?.message ?? 'Provider invocation failed' },
      );
    }

    await this.emitAudit(context, capabilityId, attempts[attempts.length - 1]?.provider ?? 'none', false, correlationId, undefined, lastError);
    throw lastError ?? new AppError('All providers are unavailable', ErrorCode.SERVICE_UNAVAILABLE);
  }

  private selectProviders(definition: CapabilityDefinition, context: CapabilityContext): ProviderDefinition[] {
    let candidates = this.providers.forCapability(definition.id);
    if (context.allowedProviders) candidates = candidates.filter((p) => context.allowedProviders!.includes(p.id));
    if (context.requestedProvider) {
      candidates = candidates.filter((p) => p.id === context.requestedProvider);
    }
    if (context.region) {
      candidates = candidates.filter((p) => !p.regions?.length || p.regions.includes(context.region!));
    }
    return candidates;
  }

  private async invokeWithDeadline<I, O>(
    provider: ProviderDefinition<I, O>,
    context: CapabilityContext,
    input: I,
    timeoutMs: number,
  ): Promise<import('./types').ProviderResult<O>> {
    const controller = new AbortController();
    const timeout = Math.min(timeoutMs, context.deadlineAt ? Math.max(1, context.deadlineAt - Date.now()) : timeoutMs);
    const timer = setTimeout(() => controller.abort(), timeout);
    const signal = context.signal
      ? AbortSignal.any ? AbortSignal.any([context.signal, controller.signal]) : context.signal
      : controller.signal;
    try {
      return await provider.adapter.invoke({ ...context, signal }, input);
    } catch (error) {
      if (controller.signal.aborted) throw new AppError('Provider invocation timed out', ErrorCode.TIMEOUT);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async emitAudit(
    context: CapabilityContext,
    capabilityId: string,
    provider: ProviderDefinition | string,
    success: boolean,
    correlationId: string,
    result?: import('./types').ProviderResult,
    error?: AppError | null,
  ): Promise<void> {
    await emit({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorType: context.actorType ?? 'service',
      action: 'integration.provider.invoke',
      outcome: success ? 'success' : 'failure',
      resource: capabilityId,
      resourceId: typeof provider === 'string' ? provider : provider.id,
      traceId: context.traceId ?? correlationId,
      sessionId: context.sessionId,
      description: success ? 'Provider invocation completed' : error?.message ?? 'Provider invocation failed',
      metadata: {
        capability: capabilityId,
        provider: typeof provider === 'string' ? provider : provider.id,
        usage: result?.usage,
        errorCode: error?.code,
        correlationId,
      },
    });
  }

  private async emitMetering(
    context: CapabilityContext,
    capabilityId: string,
    provider: ProviderDefinition,
    result: import('./types').ProviderResult,
  ): Promise<void> {
    const baseKey = context.idempotencyKey ?? `${context.tenantId}:${context.actorId}:${capabilityId}:${Date.now()}`;
    await recordUsage({
      tenantId: context.tenantId,
      actorId: context.actorId,
      eventType: 'provider_call',
      quantity: 1,
      idempotencyKey: `${baseKey}:provider_call`,
      resourceId: provider.id,
      metadata: { capability: capabilityId, provider: provider.id, usage: result.usage },
    });

    for (const [dimension, quantity] of Object.entries(result.usage?.dimensions ?? {})) {
      const eventType = dimension === 'inputTokens' ? 'llm_token_input' : dimension === 'outputTokens' ? 'llm_token_output' : dimension;
      await recordUsage({
        tenantId: context.tenantId,
        actorId: context.actorId,
        eventType,
        quantity,
        idempotencyKey: `${baseKey}:${eventType}`,
        resourceId: provider.id,
        metadata: { capability: capabilityId, provider: provider.id },
      });
    }
  }
}

export function createIntegrationRouter(options: IntegrationRouterOptions = {}): IntegrationRouter {
  return new IntegrationRouter(options);
}
