import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ErrorCode } from '@platform/utils';
import { IntegrationRouter } from '../src/router';
import { CapabilityRegistry, ProviderRegistry } from '../src/registry';
import { InMemoryProviderHealthStore } from '../src/health';
import { InMemoryIdempotencyStore } from '../src/idempotency';

describe('IntegrationRouter', () => {
  function build() {
    const capabilities = new CapabilityRegistry();
    const providers = new ProviderRegistry();

    capabilities.register({
      id: 'test.echo',
      version: 'v1',
      description: 'Echo',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      idempotency: 'none',
      riskLevel: 1,
      externalImpact: false,
      requiresConfirmation: false,
      defaultTimeoutMs: 1000,
    });

    providers.register({
      id: 'primary',
      displayName: 'Primary',
      capabilities: ['test.echo'],
      priority: 10,
      adapter: { invoke: async (_ctx, input: { value: string }) => ({ output: input }) },
    });

    return new IntegrationRouter({
      capabilities,
      providers,
      healthStore: new InMemoryProviderHealthStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      config: { maxAttempts: 1 },
    });
  }

  it('invokes a capability through its registered provider', async () => {
    const result = await build().invoke('test.echo', { value: 'hello' }, { tenantId: 't1', actorId: 'a1' });
    expect(result.output).toEqual({ value: 'hello' });
    expect(result.provider).toBe('primary');
  });

  it('rejects invalid capability input', async () => {
    await expect(build().invoke('test.echo', { value: 123 }, { tenantId: 't1', actorId: 'a1' }))
      .rejects.toMatchObject({ code: ErrorCode.UNPROCESSABLE });
  });

  it('falls back to the next provider on retryable failure', async () => {
    const capabilities = new CapabilityRegistry();
    const providers = new ProviderRegistry();
    capabilities.register({
      id: 'test.fallback', version: 'v1', description: 'Fallback', idempotency: 'none',
      riskLevel: 1, externalImpact: false, requiresConfirmation: false, defaultTimeoutMs: 1000,
    });
    providers.register({
      id: 'first', displayName: 'First', capabilities: ['test.fallback'], priority: 1,
      adapter: { invoke: async () => { throw new AppError('down', ErrorCode.SERVICE_UNAVAILABLE); } },
    });
    providers.register({
      id: 'second', displayName: 'Second', capabilities: ['test.fallback'], priority: 2,
      adapter: { invoke: async () => ({ output: { ok: true } }) },
    });
    const router = new IntegrationRouter({
      capabilities, providers, config: { maxAttempts: 2 },
    });

    const result = await router.invoke('test.fallback', {}, { tenantId: 't1', actorId: 'a1' });
    expect(result.provider).toBe('second');
    expect(result.attempts.map((a) => a.provider)).toEqual(['first', 'second']);
  });

  it('honors deterministic provider preferences', async () => {
    const capabilities = new CapabilityRegistry();
    const providers = new ProviderRegistry();
    capabilities.register({
      id: 'test.preference', version: 'v1', description: 'Preference', idempotency: 'none',
      riskLevel: 1, externalImpact: false, requiresConfirmation: false, defaultTimeoutMs: 1000,
    });
    providers.register({
      id: 'slow-priority', displayName: 'Priority', capabilities: ['test.preference'], priority: 1,
      adapter: { invoke: async () => ({ output: 'priority' }) },
    });
    providers.register({
      id: 'preferred', displayName: 'Preferred', capabilities: ['test.preference'], priority: 50,
      adapter: { invoke: async () => ({ output: 'preferred' }) },
    });
    const router = new IntegrationRouter({ capabilities, providers, config: { maxAttempts: 1 } });
    const result = await router.invoke('test.preference', {}, {
      tenantId: 't1', actorId: 'a1', preferredProviders: ['preferred'],
    });
    expect(result.provider).toBe('preferred');
  });

  it('opens a circuit after the configured failure threshold', async () => {
    const capabilities = new CapabilityRegistry();
    const providers = new ProviderRegistry();
    capabilities.register({
      id: 'test.circuit', version: 'v1', description: 'Circuit', idempotency: 'none',
      riskLevel: 1, externalImpact: false, requiresConfirmation: false, defaultTimeoutMs: 1000,
    });
    let calls = 0;
    providers.register({
      id: 'failing', displayName: 'Failing', capabilities: ['test.circuit'], priority: 1,
      adapter: { invoke: async () => { calls += 1; throw new AppError('down', ErrorCode.SERVICE_UNAVAILABLE); } },
    });
    const router = new IntegrationRouter({
      capabilities, providers,
      config: { maxAttempts: 1, circuitFailureThreshold: 2, circuitOpenMs: 60000 },
    });
    for (let i = 0; i < 2; i++) {
      await expect(router.invoke('test.circuit', {}, { tenantId: 't1', actorId: 'a1' }))
        .rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE });
    }
    expect(calls).toBe(2);
    await expect(router.invoke('test.circuit', {}, { tenantId: 't1', actorId: 'a1' }))
      .rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE });
    expect(calls).toBe(2);
  });

  it('enforces required idempotency', async () =>
    const capabilities = new CapabilityRegistry();
    capabilities.register({
      id: 'test.mutation', version: 'v1', description: 'Mutation', idempotency: 'required',
      riskLevel: 5, externalImpact: true, requiresConfirmation: true, defaultTimeoutMs: 1000,
    });
    const providers = new ProviderRegistry();
    providers.register({
      id: 'mutator', displayName: 'Mutator', capabilities: ['test.mutation'], priority: 1,
      adapter: { invoke: async () => ({ output: { id: '1' } }) },
    });
    const router = new IntegrationRouter({ capabilities, providers });
    await expect(router.invoke('test.mutation', {}, { tenantId: 't1', actorId: 'a1' }))
      .rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    const result = await router.invoke('test.mutation', {}, { tenantId: 't1', actorId: 'a1', idempotencyKey: 'key-1' });
    expect(result.output).toEqual({ id: '1' });
    const replay = await router.invoke('test.mutation', {}, { tenantId: 't1', actorId: 'a1', idempotencyKey: 'key-1' });
    expect(replay.output).toEqual({ id: '1' });
  });
});
