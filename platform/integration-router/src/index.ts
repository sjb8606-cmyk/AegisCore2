export * from './types';
export * from './errors';
export * from './registry';
export * from './health';
export * from './idempotency';
export * from './router';
export * from './adapters';

import { IntegrationRouter } from './router';
import { CapabilityRegistry, ProviderRegistry } from './registry';
import { PostgresProviderHealthStore } from './health';
import { PostgresIdempotencyStore } from './idempotency';
import { capabilityDefinitions, groqProvider, elevenLabsProvider, didProvider } from './adapters';

export function createDefaultIntegrationRouter(): IntegrationRouter {
  const capabilities = new CapabilityRegistry();
  const providers = new ProviderRegistry();

  capabilities.register(capabilityDefinitions.textGeneration as any);
  capabilities.register(capabilityDefinitions.speechGeneration as any);
  capabilities.register(capabilityDefinitions.avatarVideo as any);

  providers.register(groqProvider());
  providers.register(elevenLabsProvider());
  providers.register(didProvider());

  return new IntegrationRouter({ capabilities, providers, healthStore: new PostgresProviderHealthStore(), idempotencyStore: new PostgresIdempotencyStore() });
}
