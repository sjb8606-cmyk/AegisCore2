/**
 * platform/aegis-swarm/src/employees/innovation-architect.ts
 *
 * E-10 — Innovation Architect.
 *
 * Deliberately different in kind from the other "master's method as
 * algorithm" employees tonight — this one's real core is a genuine
 * graph algorithm (Kahn's algorithm for topological sort with cycle
 * detection), not a historical citation. Its distinct job: take a
 * loose set of technical components — from a research finding, an
 * E-08 R&D Council brief, or any raw invention — and turn it into an
 * actual buildable sequence, catching a genuinely invalid design
 * (a circular dependency) before anyone starts building against it.
 *
 * Deliberately kept separate from E-01's groundConcept() (which
 * handles feasibility/cost/pilot structure for any concept) and from
 * E-08 (cross-domain research synthesis) — this bot's job starts
 * where those leave off: once there's a set of named components with
 * real dependencies between them, what order can they actually be
 * built in, and is that order even possible at all.
 *
 * Verified against real cases (a valid chain, a genuine circular
 * dependency, a realistic multi-component design) before
 * implementation. Fully real and deterministic — no LLM call needed.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface TechComponent {
  id: string;
  description: string;
  dependsOn: string[];
}

export interface BuildOrderResult {
  buildOrder: string[];
  hasCycle: boolean;
  cycleComponents: string[];
}

export function computeBuildOrder(components: TechComponent[]): BuildOrderResult {
  const inDegree: Record<string, number> = {};
  const graph: Record<string, string[]> = {};

  for (const c of components) {
    inDegree[c.id] = 0;
    graph[c.id] = [];
  }
  for (const c of components) {
    for (const dep of c.dependsOn) {
      if (!(dep in graph)) continue;
      graph[dep].push(c.id);
      inDegree[c.id]++;
    }
  }

  const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of graph[id]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  const hasCycle = order.length !== components.length;
  const cycleComponents = hasCycle ? components.filter((c) => !order.includes(c.id)).map((c) => c.id) : [];

  return { buildOrder: hasCycle ? [] : order, hasCycle, cycleComponents };
}

export function identifyCoreComponents(components: TechComponent[]): { core: string[]; enhancement: string[] } {
  const dependedOn = new Set<string>();
  for (const c of components) {
    for (const dep of c.dependsOn) dependedOn.add(dep);
  }
  const core = components.filter((c) => dependedOn.has(c.id)).map((c) => c.id);
  const enhancement = components.filter((c) => !dependedOn.has(c.id)).map((c) => c.id);
  return { core, enhancement };
}

export interface ArchitectureReport {
  buildOrder: BuildOrderResult;
  coreComponents: string[];
  enhancementComponents: string[];
}

export class InnovationArchitectBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async architect(components: TechComponent[]): Promise<ArchitectureReport> {
    await this.enforcePermission('read:technical-components');

    const buildOrder = computeBuildOrder(components);
    const { core, enhancement } = identifyCoreComponents(components);

    const report: ArchitectureReport = {
      buildOrder,
      coreComponents: core,
      enhancementComponents: enhancement,
    };

    await this.createDecision(
      { componentCount: components.length },
      { hasCycle: buildOrder.hasCycle, coreCount: core.length },
      'innovation-architect-v1',
    );

    if (buildOrder.hasCycle) {
      await this.signalSwarm('employee.circular_dependency_found', {
        botId: this.botId,
        cycleComponents: buildOrder.cycleComponents,
      });
    }

    return report;
  }
}
