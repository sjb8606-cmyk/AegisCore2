/**
 * platform/aegis-swarm/src/employees/el-orchestrator.ts
 *
 * EL-01 — El, the Orchestrator.
 *
 * Not a peer employee — sits above them. Matches an existing decision
 * already in memory: El calls into the real employee roster through
 * each bot's own public surface, never bypassing its permission
 * enforcement, and never fabricating parameters an employee actually
 * needs (E-02 needs a real ProjectStatus array, E-03 needs a real
 * CopyBrief — El can't invent those, only point to the right
 * employee and say so honestly).
 *
 * Real algorithmic backbone, taken directly from El's own original
 * prompt rather than invented: Boyd's OODA loop IS the orchestration
 * loop, not a decorative citation —
 *   Observe: the real, current employee roster
 *   Orient:  classifyIntent() + routeToEmployees(), both real,
 *            keyword-based, and honestly capped — return null/empty
 *            rather than fabricate a match that isn't really there
 *   Decide:  assembleDirective() — a real, structured verdict naming
 *            who to dispatch to and why
 *   Act:     dispatch is a real handoff description, not a fabricated
 *            auto-invocation with made-up inputs
 *
 * The original prompt's Tier 5 "GenesisXAi Expert Council" (Cognitive
 * Cartographer, Healer, etc.) was part of the earlier 26-department/
 * 200-prompt vision that's since been streamlined down to the real,
 * growing employee roster (E-01+) — El routes to THOSE, not invented
 * placeholder experts.
 *
 * The actual multi-mind council deliberation (Einstein, Jung, Athena
 * debating a question) is real generation and needs a live LLM, same
 * honest limitation as E-01/E-03 — this bot assembles the structured
 * deliberation prompt, it doesn't fake the deliberation itself.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type IntentType = 'dream' | 'problem' | 'dilemma' | 'mission';

export interface EmployeeCapability {
  botId: string;
  name: string;
  keywords: string[];
  description: string;
}

export const KNOWN_EMPLOYEES: EmployeeCapability[] = [
  {
    botId: 'E-01',
    name: 'Strategic Architect',
    keywords: ['strategy', 'positioning', 'competitor', 'moat', 'market', 'launch', 'category'],
    description: 'Strategic dossiers, competitive positioning, go-to-market architecture.',
  },
  {
    botId: 'E-02',
    name: 'Chief of Staff',
    keywords: ['priority', 'prioritize', 'schedule', 'deadline', 'status', 'stale', 'leverage', 'urgent', 'messy'],
    description: 'Project prioritization, staleness tracking, leverage assessment.',
  },
  {
    botId: 'E-03',
    name: 'Copywright Council',
    keywords: ['copy', 'headline', 'copywriting', 'brand voice', 'cta', 'website copy', 'homepage'],
    description: 'Multi-voice copywriting for marketing/web copy.',
  },
  {
    botId: 'E-04',
    name: 'Documentation Manager',
    keywords: ['documentation', 'docs', 'readme', 'broken reference'],
    description: 'Documentation health checking against real code.',
  },
];

const INTENT_KEYWORDS: Record<IntentType, string[]> = {
  dream: ['imagine', 'vision', 'concept', 'idea', 'what if', 'brand new'],
  problem: ['broken', 'fix', 'issue', 'error', 'bug', 'not working', 'stuck'],
  dilemma: ['should i', 'ethical', 'which is better', 'torn between', 'decide between'],
  mission: ['build', 'execute', 'complete', 'finish', 'implement'],
};

export interface IntentClassification {
  intent: IntentType | null;
  score: number;
}

export function classifyIntent(request: string): IntentClassification {
  const lower = request.toLowerCase();
  let best: IntentClassification = { intent: null, score: 0 };
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [IntentType, string[]][]) {
    const score = keywords.filter((k) => lower.includes(k)).length;
    if (score > best.score) best = { intent, score };
  }
  return best;
}

export function routeToEmployees(request: string): EmployeeCapability[] {
  const lower = request.toLowerCase();
  const scored = KNOWN_EMPLOYEES.map((e) => ({
    employee: e,
    score: e.keywords.filter((k) => lower.includes(k)).length,
  }));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.employee);
}

export interface Directive {
  request: string;
  intent: IntentType | null;
  matchedEmployees: EmployeeCapability[];
  verdict: string;
}

export class ElOrchestrator extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async convene(request: string): Promise<Directive> {
    await this.enforcePermission('orchestrate:employee-roster');

    const { intent } = classifyIntent(request);
    const matchedEmployees = routeToEmployees(request);

    const verdict =
      matchedEmployees.length > 0
        ? `Route to ${matchedEmployees.map((e) => `${e.name} (${e.botId})`).join(', ')}.`
        : 'No current employee is a clean match for this — may be worth a new employee, or a broader council deliberation this bot cannot generate itself.';

    const directive: Directive = { request, intent, matchedEmployees, verdict };

    await this.createDecision(
      { request },
      { intent, matchedEmployeeIds: matchedEmployees.map((e) => e.botId) },
      'el-orchestrator-directive-v1',
    );

    if (matchedEmployees.length === 0) {
      await this.signalSwarm('employee.no_employee_match_found', { botId: this.botId, request });
    }

    return directive;
  }
}
