/**
 * platform/aegis-swarm/src/employees/chief-of-staff.ts
 *
 * E-02 — Chief of Staff.
 *
 * Built the way the person asked: the master's actual thinking method
 * baked directly into how the bot reasons, no quotes or citation
 * theater. Three separate real methodologies answer three separate
 * real questions here, rather than one all-purpose "pick a lens" like
 * E-01 needs — each is a genuine algorithm, not a citation:
 *
 * - Eisenhower's urgent/important matrix IS the classification logic
 *   in classifyProject() — not a "lens," the literal decision rule.
 * - Drucker's "what gets measured gets managed" IS the staleness
 *   detector — a project nobody has touched in 14+ days drifts
 *   regardless of which quadrant it's in, so it's flagged
 *   independently.
 * - Andy Grove's managerial leverage concept (High Output Management)
 *   IS assessLeverage() — downstream impact is a genuinely separate
 *   signal from urgency or importance. A project can be "schedule"
 *   under Eisenhower (important, not urgent) while ALSO being
 *   high-leverage — verified directly before this was implemented:
 *   Eisenhower alone would never surface that distinction on its own.
 *
 * This means the entire core of this bot is real and fully testable
 * without any LLM connection.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type Priority = 'high' | 'medium' | 'low';
export type Quadrant = 'do_first' | 'schedule' | 'delegate_or_batch' | 'eliminate_or_defer';

const URGENT_THRESHOLD_DAYS = 7;
const STALE_THRESHOLD_DAYS = 14;
const HIGH_LEVERAGE_THRESHOLD = 3;

export interface ProjectStatus {
  name: string;
  deadlineDaysAway: number | null;
  blocksOtherWork: boolean;
  statedPriority: Priority;
  lastUpdatedDaysAgo: number;
  downstreamImpactCount?: number;
}

export interface PrioritizedProject {
  name: string;
  quadrant: Quadrant;
  stale: boolean;
  highLeverage: boolean;
  reasoning: string;
  leverageReasoning: string;
}

export interface StatusDigest {
  doFirst: PrioritizedProject[];
  schedule: PrioritizedProject[];
  delegateOrBatch: PrioritizedProject[];
  eliminateOrDefer: PrioritizedProject[];
  staleCount: number;
  highLeverageCount: number;
  topPriority: PrioritizedProject | null;
}

export function assessLeverage(project: ProjectStatus): { highLeverage: boolean; leverageReasoning: string } {
  const impact = project.downstreamImpactCount ?? 0;
  const highLeverage = impact >= HIGH_LEVERAGE_THRESHOLD || project.blocksOtherWork;

  const leverageReasoning = highLeverage
    ? project.blocksOtherWork
      ? 'Blocks other work directly — real leverage regardless of downstream count.'
      : `Affects ${impact} other thing(s) downstream — disproportionate value relative to its own size.`
    : 'Limited downstream impact — a solid, self-contained task, not a force multiplier.';

  return { highLeverage, leverageReasoning };
}

export function classifyProject(project: ProjectStatus): PrioritizedProject {
  const urgent =
    (project.deadlineDaysAway !== null && project.deadlineDaysAway <= URGENT_THRESHOLD_DAYS) ||
    project.blocksOtherWork;
  const important = project.statedPriority === 'high' || project.blocksOtherWork;

  let quadrant: Quadrant;
  let reasoning: string;

  if (urgent && important) {
    quadrant = 'do_first';
    reasoning = project.blocksOtherWork
      ? 'Blocks other work — urgent and important by definition.'
      : `Deadline in ${project.deadlineDaysAway} day(s) and marked high priority.`;
  } else if (important && !urgent) {
    quadrant = 'schedule';
    reasoning = "High priority but no near-term deadline — protect real time for this, don't let it get crowded out.";
  } else if (urgent && !important) {
    quadrant = 'delegate_or_batch';
    reasoning = 'Time pressure without high stated priority — worth batching or handing off rather than context-switching for.';
  } else {
    quadrant = 'eliminate_or_defer';
    reasoning = 'No urgency, no stated high priority — genuinely fine to defer.';
  }

  const stale = project.lastUpdatedDaysAgo >= STALE_THRESHOLD_DAYS;
  const { highLeverage, leverageReasoning } = assessLeverage(project);

  return { name: project.name, quadrant, stale, highLeverage, reasoning, leverageReasoning };
}

export class ChiefOfStaffBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async buildStatusDigest(projects: ProjectStatus[]): Promise<StatusDigest> {
    await this.enforcePermission('read:project-status');

    const classified = projects.map(classifyProject);

    const doFirst = classified.filter((p) => p.quadrant === 'do_first');
    const topPriority = doFirst.find((p) => p.highLeverage) ?? doFirst[0] ?? null;

    const digest: StatusDigest = {
      doFirst,
      schedule: classified.filter((p) => p.quadrant === 'schedule'),
      delegateOrBatch: classified.filter((p) => p.quadrant === 'delegate_or_batch'),
      eliminateOrDefer: classified.filter((p) => p.quadrant === 'eliminate_or_defer'),
      staleCount: classified.filter((p) => p.stale).length,
      highLeverageCount: classified.filter((p) => p.highLeverage).length,
      topPriority,
    };

    await this.createDecision(
      { projectCount: projects.length },
      { doFirstCount: digest.doFirst.length, staleCount: digest.staleCount, highLeverageCount: digest.highLeverageCount },
      'chief-of-staff-digest-v1',
    );

    if (digest.staleCount > 0) {
      await this.signalSwarm('employee.stale_projects_found', {
        botId: this.botId,
        staleCount: digest.staleCount,
      });
    }

    return digest;
  }
}
