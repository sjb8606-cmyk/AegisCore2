/**
 * platform/model-marketplace/src/index.ts
 */

const ACCESS_TIER_RANK: Record<string, number> = { free: 0, paid: 1, premium: 2 };

export interface ModelListing {
  provider: string;
  modelId: string;
  displayName: string;
  capabilityTags: string[];
  costTier: 'free' | 'low' | 'medium' | 'high';
  avgLatencyMs: number;
  minAccessTier: 'free' | 'paid' | 'premium';
  configured: boolean;
}

export interface UserModelSelection {
  userId: string;
  tenantId: string;
  selectedProvider: string;
  selectedModelId: string;
  selectedAtMs: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function listAvailableModels(
  registry: ModelListing[],
  userAccessTier: string
): ModelListing[] {
  const userRank = ACCESS_TIER_RANK[userAccessTier] ?? -1;

  return registry.filter((model) => {
    if (!model.configured) return false;
    const requiredRank = ACCESS_TIER_RANK[model.minAccessTier] ?? Infinity;
    return userRank >= requiredRank;
  });
}

export function validateSelection(
  selection: UserModelSelection,
  registry: ModelListing[],
  userAccessTier: string
): ValidationResult {
  const listing = registry.find(
    (m) => m.provider === selection.selectedProvider && m.modelId === selection.selectedModelId
  );

  if (!listing) {
    return { valid: false, reason: 'Selected model is not in the real registry.' };
  }

  if (!listing.configured) {
    return { valid: false, reason: 'Selected model has no real provider API key configured right now.' };
  }

  const userRank = ACCESS_TIER_RANK[userAccessTier] ?? -1;
  const requiredRank = ACCESS_TIER_RANK[listing.minAccessTier] ?? Infinity;

  if (userRank < requiredRank) {
    return { valid: false, reason: `Selected model requires access tier '${listing.minAccessTier}'; caller has '${userAccessTier}'.` };
  }

  return { valid: true };
}

export function buildFallbackOrder(
  selection: UserModelSelection,
  registry: ModelListing[],
  defaultProvider: string
): string[] {
  const order = [selection.selectedProvider];

  if (defaultProvider !== selection.selectedProvider) {
    const defaultListing = registry.find((m) => m.provider === defaultProvider);
    if (defaultListing?.configured) {
      order.push(defaultProvider);
    }
  }

  return order;
}
