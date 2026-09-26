import { AppError, ErrorCode } from '@platform/utils';
import type { CapabilityDefinition, ProviderDefinition } from './types';

export class CapabilityRegistry {
  private readonly definitions = new Map<string, CapabilityDefinition>();

  register<I, O>(definition: CapabilityDefinition<I, O>): void {
    const key = `${definition.id}@${definition.version}`;
    if (this.definitions.has(key)) {
      throw new AppError(`Capability already registered: ${key}`, ErrorCode.CONFLICT);
    }
    this.definitions.set(key, definition as CapabilityDefinition);
  }

  get(id: string, version?: string): CapabilityDefinition | null {
    if (version) return this.definitions.get(`${id}@${version}`) ?? null;
    const matches = [...this.definitions.values()].filter((d) => d.id === id);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => Number(b.version.slice(1)) - Number(a.version.slice(1)))[0];
  }

  list(): CapabilityDefinition[] {
    return [...this.definitions.values()];
  }

  clear(): void {
    this.definitions.clear();
  }
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderDefinition>();

  register<I, O>(provider: ProviderDefinition<I, O>): void {
    if (this.providers.has(provider.id)) {
      throw new AppError(`Provider already registered: ${provider.id}`, ErrorCode.CONFLICT);
    }
    this.providers.set(provider.id, provider as ProviderDefinition);
  }

  get(id: string): ProviderDefinition | null {
    return this.providers.get(id) ?? null;
  }

  forCapability(capabilityId: string): ProviderDefinition[] {
    return [...this.providers.values()]
      .filter((p) => p.capabilities.includes(capabilityId))
      .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
  }

  list(): ProviderDefinition[] {
    return [...this.providers.values()];
  }

  clear(): void {
    this.providers.clear();
  }
}
