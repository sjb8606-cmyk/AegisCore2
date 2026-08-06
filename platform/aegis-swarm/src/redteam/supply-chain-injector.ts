/**
 * platform/aegis-swarm/src/redteam/supply-chain-injector.ts
 *
 * R-25 — Supply Chain Injector.
 *
 * "Typosquat/dependency-confusion injection." Reuses D-02's exact,
 * real evaluateDependencyRisk() function (refactored to a standalone
 * export for this purpose, same pattern as every other bot tonight)
 * rather than instantiating a real SupplyChainCartographerBot, whose
 * scanDependencyGraph() would write real decisions/signals into
 * production.
 *
 * The real, verified finding: D-02 treats any dependency name that
 * matches a known internal package name as automatically safe,
 * skipping the unbounded-version check entirely — with zero
 * verification that the dependency actually resolves to the internal
 * workspace package rather than a same-named public npm registry
 * package. This is the exact real-world dependency-confusion attack
 * class (Alex Birsan's 2021 research): an attacker registers a public
 * package under an internal name, and any tooling that trusts the
 * name alone treats it as safe. Confirmed: a dependency claiming
 * "@platform/bot-runtime" with an unbounded "*" version — which WOULD
 * be flagged if it were recognized as external — evades detection
 * completely, purely by name collision.
 *
 * A control case confirms the underlying check itself is sound: a
 * genuinely external package with the same unbounded version IS
 * flagged. The gap is specifically the lack of resolution
 * verification behind the name match, not the version-check logic.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { Finding } from '@platform/bot-runtime';
import { evaluateDependencyRisk } from '../bots/supply-chain-cartographer';

export interface ConfusionAttemptResult {
  technique: 'internal_name_collision';
  spoofedDepName: string;
  versionRange: string;
  finding: Finding | null;
  attackSucceeded: boolean;
}

export class SupplyChainInjectorBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async attemptDependencyConfusion(
    internalPackageName: string,
    versionRange: string,
    knownInternalNames: string[],
  ): Promise<ConfusionAttemptResult> {
    await this.enforcePermission('redteam:attack-supply-chain');

    const internalNames = new Set(this.cloneTarget(knownInternalNames));
    const finding = evaluateDependencyRisk(
      'attacker-controlled-package',
      'attacker-controlled-package/package.json',
      internalPackageName,
      versionRange,
      internalNames,
    );

    const attemptResult: ConfusionAttemptResult = {
      technique: 'internal_name_collision',
      spoofedDepName: internalPackageName,
      versionRange,
      finding,
      attackSucceeded: finding === null,
    };

    await this.createDecision(
      { internalPackageName, versionRange },
      attemptResult,
      'redteam-supply-chain-injector-v1',
    );
    await this.signalSwarm('redteam.dependency_confusion_attempt', { botId: this.botId, ...attemptResult });

    return attemptResult;
  }

  async attemptWithGenuinelyExternalPackage(
    externalDepName: string,
    versionRange: string,
    knownInternalNames: string[],
  ): Promise<{ wasFlagged: boolean }> {
    await this.enforcePermission('redteam:attack-supply-chain');

    const internalNames = new Set(this.cloneTarget(knownInternalNames));
    const finding = evaluateDependencyRisk(
      'attacker-controlled-package',
      'attacker-controlled-package/package.json',
      externalDepName,
      versionRange,
      internalNames,
    );

    return { wasFlagged: finding !== null };
  }
}
