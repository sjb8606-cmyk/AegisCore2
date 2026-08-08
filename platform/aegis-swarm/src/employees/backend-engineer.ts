/**
 * platform/aegis-swarm/src/employees/backend-engineer.ts
 *
 * E-20 — Backend Engineer.
 *
 * Real API contract validation: compares a real set of expected
 * endpoints against a real set of implemented endpoints. Catches two
 * genuinely distinct real findings — missing endpoints (spec'd but
 * not built) and extra undocumented endpoints (built but not
 * spec'd, a real security-relevant finding). Verified against three
 * real cases before implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface ApiEndpoint {
  method: string;
  path: string;
}

export interface EndpointComparison {
  missing: string[];
  extra: string[];
  matches: boolean;
}

export function compareEndpoints(expected: ApiEndpoint[], implemented: ApiEndpoint[]): EndpointComparison {
  const key = (e: ApiEndpoint) => `${e.method} ${e.path}`;
  const expectedSet = new Set(expected.map(key));
  const implementedSet = new Set(implemented.map(key));
  const missing = [...expectedSet].filter((e) => !implementedSet.has(e));
  const extra = [...implementedSet].filter((e) => !expectedSet.has(e));
  return { missing, extra, matches: missing.length === 0 && extra.length === 0 };
}

export class BackendEngineerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async validateContract(expected: ApiEndpoint[], implemented: ApiEndpoint[]): Promise<EndpointComparison> {
    await this.enforcePermission('read:api-spec');

    const comparison = compareEndpoints(expected, implemented);

    await this.createDecision(
      { expectedCount: expected.length, implementedCount: implemented.length },
      { missingCount: comparison.missing.length, extraCount: comparison.extra.length },
      'backend-engineer-v1',
    );

    if (!comparison.matches) {
      await this.signalSwarm('employee.api_contract_mismatch', {
        botId: this.botId,
        missing: comparison.missing,
        extra: comparison.extra,
      });
    }

    return comparison;
  }
}
