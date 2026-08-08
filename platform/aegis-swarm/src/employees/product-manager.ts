/**
 * platform/aegis-swarm/src/employees/product-manager.ts
 *
 * E-11 — Product Manager.
 *
 * Real MoSCoW prioritization (Must/Should/Could/Won't-this-time),
 * the actual requirements-scoping framework (Dai Clegg, DSDM) — as
 * literal classification logic, same discipline as E-02's Eisenhower
 * matrix. Deliberately distinct from E-02: this is release SCOPE
 * (does this feature belong in this release at all), not time
 * urgency. Verified against five real cases, including the priority
 * order (explicit out-of-scope wins even over a core-blocking
 * feature) before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type MoscowCategory = 'must' | 'should' | 'could' | 'wont';

export interface FeatureRequest {
  name: string;
  blocksCoreFunction: boolean;
  legalOrComplianceRequired: boolean;
  workaroundExists: boolean;
  explicitlyOutOfScope: boolean;
}

export interface ClassifiedFeature {
  name: string;
  category: MoscowCategory;
  reasoning: string;
}

export function classifyMoscow(feature: FeatureRequest): ClassifiedFeature {
  let category: MoscowCategory;
  let reasoning: string;

  if (feature.explicitlyOutOfScope) {
    category = 'wont';
    reasoning = 'Explicitly declared out of scope for this release.';
  } else if (feature.blocksCoreFunction) {
    category = 'must';
    reasoning = 'The system does not work at all without this.';
  } else if (feature.legalOrComplianceRequired) {
    category = 'must';
    reasoning = 'Legal or compliance requirement — not optional.';
  } else if (!feature.workaroundExists) {
    category = 'should';
    reasoning = 'Important, but no acceptable workaround exists without it.';
  } else {
    category = 'could';
    reasoning = 'A real workaround exists — genuinely deferrable.';
  }

  return { name: feature.name, category, reasoning };
}

export interface ReleaseScope {
  must: ClassifiedFeature[];
  should: ClassifiedFeature[];
  could: ClassifiedFeature[];
  wont: ClassifiedFeature[];
}

export class ProductManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async scopeRelease(features: FeatureRequest[]): Promise<ReleaseScope> {
    await this.enforcePermission('read:feature-requests');

    const classified = features.map(classifyMoscow);
    const scope: ReleaseScope = {
      must: classified.filter((f) => f.category === 'must'),
      should: classified.filter((f) => f.category === 'should'),
      could: classified.filter((f) => f.category === 'could'),
      wont: classified.filter((f) => f.category === 'wont'),
    };

    await this.createDecision(
      { featureCount: features.length },
      { mustCount: scope.must.length, wontCount: scope.wont.length },
      'product-manager-scope-v1',
    );

    return scope;
  }
}
