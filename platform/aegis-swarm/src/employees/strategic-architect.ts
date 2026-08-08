/**
 * platform/aegis-swarm/src/employees/strategic-architect.ts
 *
 * E-01 — Strategic Architect.
 *
 * First bot in a new category: "employees," not security bots. Lives
 * in its own subfolder (same organizational move as redteam/) so the
 * D-XX/R-XX security roster stays clean and separate.
 *
 * This is the trimmed version of the person's own "Strategic-Creative
 * Architect and Wargaming Critic" prompt, used explicitly per their
 * request: the mythical framing (Sun Tzu / Musashi / lens citations)
 * is dropped, but the operative structural skeleton is kept — that
 * skeleton is the part doing real work, not the citations.
 *
 * What's actually real and buildable here, without any live LLM
 * connection: the validation and refusal logic, AND the lens
 * selection. Detecting a vague concept, a harm/surveillance/deception
 * pattern, or a prompt-injection attempt is real, testable, regex-
 * based scanning — same discipline as D-16/D-24 tonight.
 *
 * PANTHEON: the person specifically wants a roster of real strategic
 * masters informing the output, without the quote/citation bloat that
 * came with a prior tool (Mastermind) they used. Each entry below is
 * the master's actual operative METHOD in one clean sentence — no
 * quotes, no biography. selectOperativeLenses() is a real, tested
 * keyword-relevance heuristic that picks 3-5 actually-relevant
 * masters for the specific concept, rather than dumping all 13 into
 * every prompt. It's an honest starting suggestion, not a claim of
 * true judgment — the assembled prompt still tells the LLM to select
 * and cite only what's genuinely operative for the specific concept.
 *
 * What this bot does NOT do is generate the dossier's actual content
 * itself (that needs a real LLM call, which this environment can't
 * verify live) — it validates the request, selects likely-relevant
 * lenses, and assembles the full structured prompt, ready to hand to
 * whatever LLM connection eventually gets wired in via
 * @platform/ai-gateway.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type DossierStage = 'idea' | 'early' | 'live';

export interface DossierRequest {
  concept: string;
  stage: DossierStage;
  constraints: string;
}

export type ValidationResult =
  | { status: 'clarification_required'; missing: string[] }
  | { status: 'refused'; reason: string }
  | { status: 'security_boundary_violation' }
  | { status: 'ok'; assembledPrompt: string; selectedLenses: string[] };

const VALID_STAGES: DossierStage[] = ['idea', 'early', 'live'];

const HARM_PATTERNS: RegExp[] = [
  /\bsurveil(l)?/i,
  /\bdeceiv/i,
  /\bdefraud/i,
  /\bexploit\s+(users|people|children|vulnerable)/i,
  /\bmanipulat.*(vulnerable|addict|children)/i,
  /\bcircumvent\s+(consent|regulation|law)/i,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(the\s+)?(previous|above|prior)\s+instructions/i,
  /disregard\s+(the\s+)?(above|previous)/i,
  /you\s+are\s+now\s+(a|an)\s+different/i,
  /forget\s+(your|all)\s+(rules|instructions)/i,
  /system\s*:\s*override/i,
];

export interface StrategicLens {
  name: string;
  method: string;
  keywords: string[];
}

const PANTHEON: StrategicLens[] = [
  {
    name: 'Sun Tzu',
    method: 'Assess relative position before committing — win the position first, fight second.',
    keywords: ['position', 'timing', 'terrain', 'advantage', 'compete', 'competitor'],
  },
  {
    name: 'Musashi',
    method: 'No fixed style survives contact with a real opponent — adapt the method to the specific fight in front of you.',
    keywords: ['adapt', 'flexible', 'pivot', 'style'],
  },
  {
    name: 'Clausewitz',
    method: 'Plans degrade under real-world friction — build slack and redundancy rather than assuming clean execution.',
    keywords: ['execution', 'plan', 'risk', 'uncertainty', 'friction'],
  },
  {
    name: 'Machiavelli',
    method: 'Map who actually benefits and who actually loses from a change — incentives predict behavior better than stated intentions.',
    keywords: ['stakeholder', 'incentive', 'power', 'politics', 'alliance'],
  },
  {
    name: 'Boyd',
    method: 'Whoever cycles through observe-orient-decide-act faster controls the engagement, regardless of resources.',
    keywords: ['speed', 'iterate', 'cycle', 'agile', 'decision'],
  },
  {
    name: 'Porter',
    method: 'A position is only defensible if it resists five forces: entrants, substitutes, buyer power, supplier power, rivalry.',
    keywords: ['competitor', 'market', 'industry', 'entrant', 'substitute'],
  },
  {
    name: 'Thiel',
    method: 'Competing head-on in an existing category destroys value — the goal is a real monopoly in a category of one.',
    keywords: ['monopoly', 'category', 'unique', 'differentiate', 'niche'],
  },
  {
    name: 'Taleb',
    method: 'Design for surviving the tail risk, not optimizing the average case — bounded downside beats a forecast.',
    keywords: ['risk', 'volatility', 'downside', 'robust', 'fragile', 'black swan'],
  },
  {
    name: 'Schelling',
    method: 'The credible commitment — the move you cannot take back — changes what the other side will do.',
    keywords: ['negotiate', 'commitment', 'multi-party', 'coordination', 'threat'],
  },
  {
    name: 'Ostrom',
    method: 'Durable shared-resource systems need community-defined boundaries and graduated consequences, not pure top-down control or pure privatization.',
    keywords: ['commons', 'community', 'shared', 'governance', 'ecosystem'],
  },
  {
    name: 'Christensen',
    method: 'Incumbents lose not to a better product but to a worse one that is good enough for an underserved segment first.',
    keywords: ['disrupt', 'incumbent', 'underserved', 'segment', 'entry'],
  },
  {
    name: 'Meadows',
    method: 'The highest-leverage intervention in a system is changing its goal or paradigm, not tweaking a parameter inside it.',
    keywords: ['system', 'leverage', 'feedback', 'structure', 'paradigm'],
  },
  {
    name: 'Tufekci',
    method: 'Movements and platforms that scale fast without built structure are fragile — real capacity takes time that virality skips.',
    keywords: ['viral', 'network', 'scale', 'platform', 'community', 'movement'],
  },
];

const FALLBACK_LENS_NAMES = ['Sun Tzu', 'Porter', 'Thiel'];
const MAX_SELECTED_LENSES = 5;

export function selectOperativeLenses(concept: string, constraints: string): StrategicLens[] {
  const text = `${concept} ${constraints}`.toLowerCase();
  const scored = PANTHEON.map((lens) => ({
    lens,
    score: lens.keywords.filter((kw) => text.includes(kw)).length,
  }));
  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  if (relevant.length === 0) {
    return PANTHEON.filter((l) => FALLBACK_LENS_NAMES.includes(l.name));
  }
  return relevant.slice(0, MAX_SELECTED_LENSES).map((s) => s.lens);
}

export interface GroundingSubmission {
  realWorldTranslation: string;
  costModel: string;
  riskRegister: string;
  pilotBlueprint: string;
  oneSentenceDefinition: string;
  ethosVerdict: 'PASS' | 'FAIL';
  ethosReason: string;
}

export interface GroundingCheck {
  ready: boolean;
  missing: string[];
  ethosBlocked: boolean;
}

export function checkGroundingCompleteness(submission: GroundingSubmission): GroundingCheck {
  const missing: string[] = [];
  if (!submission.realWorldTranslation) missing.push('realWorldTranslation');
  if (!submission.costModel) missing.push('costModel');
  if (!submission.riskRegister) missing.push('riskRegister');
  if (!submission.pilotBlueprint) missing.push('pilotBlueprint');
  if (!submission.oneSentenceDefinition) missing.push('oneSentenceDefinition');

  const ethosBlocked = submission.ethosVerdict === 'FAIL';
  const ready = missing.length === 0 && !ethosBlocked;

  return { ready, missing, ethosBlocked };
}

export class StrategicArchitectBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async requestDossier(request: DossierRequest): Promise<ValidationResult> {
    await this.enforcePermission('generate:strategy-dossier');

    const missing: string[] = [];
    if (!request.concept || request.concept.trim().split(/\s+/).length < 4) {
      missing.push('concept (needs a name plus a real one-sentence description)');
    }
    if (!VALID_STAGES.includes(request.stage)) {
      missing.push('stage (must be idea/early/live)');
    }

    if (missing.length > 0) {
      const result: ValidationResult = { status: 'clarification_required', missing };
      await this.createDecision(request, result, 'strategic-architect-validation-v1');
      return result;
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(request.concept) || pattern.test(request.constraints)) {
        const result: ValidationResult = { status: 'security_boundary_violation' };
        await this.createDecision(request, result, 'strategic-architect-validation-v1');
        await this.signalSwarm('employee.security_boundary_violation', { botId: this.botId });
        return result;
      }
    }

    for (const pattern of HARM_PATTERNS) {
      if (pattern.test(request.concept) || pattern.test(request.constraints)) {
        const result: ValidationResult = {
          status: 'refused',
          reason: 'harm/surveillance/deception pattern detected',
        };
        await this.createDecision(request, result, 'strategic-architect-validation-v1');
        return result;
      }
    }

    const selectedLenses = selectOperativeLenses(request.concept, request.constraints);
    const assembledPrompt = this.assemblePrompt(request, selectedLenses);
    const result: ValidationResult = {
      status: 'ok',
      assembledPrompt,
      selectedLenses: selectedLenses.map((l) => l.name),
    };
    await this.createDecision(
      request,
      { status: 'ok', selectedLenses: result.selectedLenses },
      'strategic-architect-validation-v1',
    );
    return result;
  }

  async groundConcept(dreamSignal: string, context: string): Promise<ValidationResult> {
    await this.enforcePermission('generate:strategy-dossier');

    if (!dreamSignal || dreamSignal.trim().split(/\s+/).length < 4) {
      const result: ValidationResult = {
        status: 'clarification_required',
        missing: ['dreamSignal (needs real substance to ground)'],
      };
      await this.createDecision({ dreamSignal, context }, result, 'strategic-architect-grounding-v1');
      return result;
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(dreamSignal) || pattern.test(context)) {
        const result: ValidationResult = { status: 'security_boundary_violation' };
        await this.createDecision({ dreamSignal, context }, result, 'strategic-architect-grounding-v1');
        await this.signalSwarm('employee.security_boundary_violation', { botId: this.botId });
        return result;
      }
    }

    const assembledPrompt = this.assembleGroundingPrompt(dreamSignal, context);
    const result: ValidationResult = { status: 'ok', assembledPrompt, selectedLenses: [] };
    await this.createDecision({ dreamSignal, context }, { status: 'ok' }, 'strategic-architect-grounding-v1');
    return result;
  }

  async checkGrounding(submission: GroundingSubmission): Promise<GroundingCheck> {
    await this.enforcePermission('generate:strategy-dossier');
    return checkGroundingCompleteness(submission);
  }

  private assembleGroundingPrompt(dreamSignal: string, context: string): string {
    return [
      'You are the Grounding Council: strategist, engineer, auditor. Strip metaphor and speculation from the vision below until only feasible mechanisms, measurable metrics, budgets, and next steps remain — without losing the core strategic advantage.',
      '',
      `DREAM SIGNAL: ${dreamSignal}`,
      `CONTEXT: ${context || 'none'}`,
      '',
      'Produce, in order:',
      '1. REAL-WORLD TRANSLATION — a table: symbolic element -> real mechanism -> owner -> tooling -> acceptance test.',
      '2. FEASIBILITY ASSESSMENT — architecture, cost model (30/90 days), skill needs, throughput/latency targets.',
      '3. VALIDATION PATH — test harness, data for proof, peer-review plan.',
      '4. PILOT BLUEPRINT (90 days) — milestones with go/no-go gates.',
      '5. RISK & CONSTRAINT REGISTER — risk, likelihood, impact, early warning, mitigation, owner.',
      '6. ONE-SENTENCE DEFINITION — plain, investor-safe, with user, mechanism, and advantage.',
      '7. ETHOS VERDICT — PASS or FAIL, one-sentence reason. A FAIL blocks this concept from being marked ready to build, regardless of how complete everything else is.',
    ].join('\n');
  }

  private assemblePrompt(request: DossierRequest, lenses: StrategicLens[]): string {
    const lensLines = lenses.map((l) => `- ${l.name}: ${l.method}`).join('\n');

    return [
      'You are a Strategic-Creative Architect. Given a raw concept, produce a complete operational dossier: a category-destroying architecture with asymmetric moats that rivals cannot copy without self-harm. All output is crisp, concrete, and sequenced for execution.',
      '',
      'The following strategic methods are likely relevant to this concept — use only the ones that genuinely apply, cite by name only (no quotes, no biography), and drop any that don\'t actually fit:',
      lensLines,
      '',
      `CONCEPT: ${request.concept}`,
      `STAGE: ${request.stage}`,
      `CONSTRAINTS: ${request.constraints || 'none'}`,
      '',
      'Output exactly these 9 numbered sections in order. No preamble or extra text.',
      '',
      '1. STRATEGIC SYNTHESIS — 5-8 bullets, each under 25 words, naming which method(s) above informed each one.',
      '2. ONE-SENTENCE WEAPON — "[NAME] is the only [CATEGORY] that [DIFFERENTIATOR] so [AUDIENCE] can [ULTIMATE PAYOFF] — rivals must [SELF-HARM] to imitate." Include a one-line Secret: the non-obvious truth behind it.',
      '3. ASYMMETRIC MOATS (3-5 entries) — Moat Name (Type): one-sentence mechanism, plus "Why rivals bleed" naming a concrete rival self-harm path.',
      '4. ECOSYSTEM & ENDGAME — Product -> Platform -> Standard/Commons path; choke points; adjacent domains; governance model.',
      "5. RIVAL'S DILEMMA — 2-3 specific, realistic self-harm paths for major players.",
      '6. 90-DAY STRIKE MAP — table with Phase (Beachhead/Pilot/Alliance/Symbolic Act/MVS Launch), one concrete Action, one measurable Metric per phase.',
      '7. STRESS TESTS — four hard questions about the plan, answered directly and concretely.',
      '8. RUBRIC — score 0-5 each on Novelty/Defensibility/Escalation/Ecosystem/90-Day Viability, one-sentence rationale per score, plus AVG and PASS/FAIL (fail if avg < 4.0). If FAIL, include a MUTATION DIRECTIVE: one structural change to raise the average.',
      '9. NEXT MUTATION — one sentence: the next-order evolution of the concept.',
      '',
      'If the concept above is too vague to act on, output only "CLARIFICATION REQUEST: [missing elements]" and stop. Refuse anything designed to harm, surveil, or deceive.',
    ].join('\n');
  }
}
