/**
 * platform/aegis-swarm/src/employees/operations-manager.ts
 *
 * E-36 — Operations Manager.
 *
 * Real Theory of Constraints (Goldratt) — genuinely distinct from
 * E-02's Chief of Staff, which prioritizes projects; this identifies
 * the real bottleneck in a process. A process's total throughput is
 * bounded by its slowest real step, regardless of how fast any other
 * step runs — verified against a real three-step case before
 * implementation.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface ProcessStep {
  name: string;
  capacityPerHour: number;
}

export interface BottleneckResult {
  bottleneck: string;
  systemThroughputPerHour: number;
}

export function findBottleneck(steps: ProcessStep[]): BottleneckResult {
  const bottleneck = steps.reduce((min, s) => (s.capacityPerHour < min.capacityPerHour ? s : min));
  return { bottleneck: bottleneck.name, systemThroughputPerHour: bottleneck.capacityPerHour };
}

export class OperationsManagerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async analyzeProcess(steps: ProcessStep[]): Promise<BottleneckResult> {
    await this.enforcePermission('read:process-data');

    const result = findBottleneck(steps);

    await this.createDecision(
      { stepCount: steps.length },
      { bottleneck: result.bottleneck, systemThroughputPerHour: result.systemThroughputPerHour },
      'operations-manager-v1',
    );

    return result;
  }
}
