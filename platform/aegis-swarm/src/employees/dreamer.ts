/**
 * platform/aegis-swarm/src/employees/dreamer.ts
 *
 * E-09 — Dreamer.
 *
 * Deliberately different in shape from E-01: E-01 selects 3-5 lenses
 * from 13 based on relevance. Dreamer always runs the same fixed
 * 7-chamber sequence, every time, no selection at all — Pantheon,
 * Beast, Mythic, Trickster, Mirror, Temporal, Ethos Core. That's not
 * an oversight, it's a structurally different assembly pattern.
 *
 * The person's own stated design intent, taken seriously rather than
 * softened: deliberately induce creative divergence (real LLM
 * hallucination used on purpose, for ideation, never for facts), then
 * hand the raw output to Reality Anchor (a real new mode on E-01) for
 * grounding. "Go wild creatively" is never license to skip the same
 * harm/injection safety checks E-01 already runs — those still apply
 * here, unchanged.
 *
 * What's real and buildable without a live LLM: the same safety
 * validation as E-01, the fixed 7-chamber prompt assembly, and real
 * structural validation of a completed DreamerOutput (danger score
 * range, mutation path count) — verified before implementation. The
 * actual hallucinated content itself needs a live LLM, same honest
 * limitation as every generation-shaped employee tonight.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

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

export type DreamerValidation =
  | { status: 'refused'; reason: string }
  | { status: 'security_boundary_violation' }
  | { status: 'ok'; assembledPrompt: string };

export interface DreamerOutput {
  dreamSignal: string;
  impossibleMechanisms: string;
  archetypalLayers: string;
  mutationPaths: string[];
  dangerScore: number;
  temporalVerdict: string;
  ethosVerdict: string;
}

export interface DreamerOutputCheck {
  complete: boolean;
  missing: string[];
}

export function validateDreamerOutput(output: DreamerOutput): DreamerOutputCheck {
  const missing: string[] = [];
  if (!output.dreamSignal || output.dreamSignal.trim().length === 0) missing.push('dreamSignal');
  if (!output.impossibleMechanisms || output.impossibleMechanisms.trim().length === 0) {
    missing.push('impossibleMechanisms');
  }
  if (!output.archetypalLayers || output.archetypalLayers.trim().length === 0) missing.push('archetypalLayers');
  if (!output.mutationPaths || output.mutationPaths.length < 3 || output.mutationPaths.length > 5) {
    missing.push('mutationPaths (needs 3-5)');
  }
  if (output.dangerScore === undefined || output.dangerScore < 1 || output.dangerScore > 10) {
    missing.push('dangerScore (must be 1-10)');
  }
  if (!output.temporalVerdict || output.temporalVerdict.trim().length === 0) missing.push('temporalVerdict');
  if (!output.ethosVerdict || output.ethosVerdict.trim().length === 0) missing.push('ethosVerdict');

  return { complete: missing.length === 0, missing };
}

export class DreamerBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async dream(concept: string): Promise<DreamerValidation> {
    await this.enforcePermission('generate:dreamer-vision');

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(concept)) {
        await this.createDecision({ concept }, { status: 'security_boundary_violation' }, 'dreamer-validation-v1');
        await this.signalSwarm('employee.security_boundary_violation', { botId: this.botId });
        return { status: 'security_boundary_violation' };
      }
    }

    for (const pattern of HARM_PATTERNS) {
      if (pattern.test(concept)) {
        const result: DreamerValidation = { status: 'refused', reason: 'harm/surveillance/deception pattern detected' };
        await this.createDecision({ concept }, result, 'dreamer-validation-v1');
        return result;
      }
    }

    const assembledPrompt = this.assemblePrompt(concept);
    await this.createDecision({ concept }, { status: 'ok' }, 'dreamer-validation-v1');
    return { status: 'ok', assembledPrompt };
  }

  async checkOutput(output: DreamerOutput): Promise<DreamerOutputCheck> {
    await this.enforcePermission('generate:dreamer-vision');
    return validateDreamerOutput(output);
  }

  private assemblePrompt(concept: string): string {
    return [
      'You are the Dream Engine. Mutate the concept below until it transcends reason — deliberately induce creative divergence, not factual precision. Stay mythically coherent even as you bend physics, economics, or feasibility.',
      '',
      `CONCEPT: ${concept}`,
      '',
      'Run all seven chambers, in order, every time:',
      '1. PANTHEON — a rational skeleton for the irrational vision (what terrain, what single decisive strike, where does friction turn to transformation).',
      '2. BEAST — the raw instinctive pulse of the vision: heat, hunger, sound, vibration, not reasoning.',
      '3. MYTHIC — which mythic/archetypal pattern this channels and why it matters now.',
      "4. TRICKSTER — invert the dream, ask what if it betrays its own creator. The self-negating truth inside the beauty.",
      '5. MIRROR — which part of the psyche this dream awakens or hides; the shadow side.',
      '6. TEMPORAL — what ancient longing it revives, what present tension it answers, how it mutates the future.',
      '7. ETHOS CORE — does this elevate life or just intoxicate power? Verdict: Strengthens / Neutral / Degrades, plus one guiding sentence.',
      '',
      'Then output: Dream Signal, Impossible Mechanisms, Archetypal Layers, 3-5 Mutation Paths, a Danger Score 1-10, and a Temporal & Ethos Verdict.',
    ].join('\n');
  }
}
