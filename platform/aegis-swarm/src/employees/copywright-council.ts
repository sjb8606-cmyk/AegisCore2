/**
 * platform/aegis-swarm/src/employees/copywright-council.ts
 *
 * E-03 — Copywright Council.
 *
 * Same treatment as E-01: the person's own frequently-used prompt,
 * with the quote/citation theater at the top (Ogilvy, Hemingway,
 * Campbell, Musashi quotes) stripped per their standing instruction,
 * keeping only the real operative method each voice contributes.
 *
 * 'byron_frankl' is preserved functionally exactly as the person's
 * own prompt describes it ("authentic warmth & existential
 * connection") — not attributed to a specific historical figure,
 * since it's unclear whether this is a synthesis of two real people
 * or the person's own invented voice. No biography is fabricated
 * either way.
 *
 * What's real and buildable without any LLM connection: mix-string
 * parsing (both "ogilvy+hemingway+campbell" equal-weight and
 * "ogilvy:50 hemingway:30 campbell:20" explicit-weight syntax),
 * preset resolution, weight validation, and brief validation — all
 * verified against real test cases before this file was written.
 * Generating the actual copy still needs a live LLM call, same
 * limitation as E-01.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export type MasterKey = 'ogilvy' | 'hemingway' | 'campbell' | 'schwartz' | 'byron_frankl' | 'musashi';

export interface MasterMethod {
  key: MasterKey;
  displayName: string;
  method: string;
}

export const COUNCIL: MasterMethod[] = [
  {
    key: 'ogilvy',
    displayName: 'Ogilvy',
    method: 'Lead with the strongest researched benefit, structure for scannability, make every claim specific enough to be falsifiable.',
  },
  {
    key: 'hemingway',
    displayName: 'Hemingway',
    method: "Cut every word that doesn't earn its place — short sentences, concrete nouns, let restraint carry the emotion instead of adjectives.",
  },
  {
    key: 'campbell',
    displayName: 'Campbell',
    method: 'Frame the reader as the protagonist mid-journey — name the ordinary struggle, the threshold moment, and the transformation on the other side.',
  },
  {
    key: 'schwartz',
    displayName: 'Schwartz',
    method: 'Meet the reader at their actual stage of awareness — channel existing desire toward the offer rather than trying to manufacture desire from nothing.',
  },
  {
    key: 'byron_frankl',
    displayName: 'Byron Frankl',
    method: "Speak from real vulnerability and shared meaning, not performed positivity — connect the offer to why it actually matters in someone's life, not just what it does.",
  },
  {
    key: 'musashi',
    displayName: 'Musashi',
    method: 'Say the least possible to land the point — no fixed formula, adapt the cut to the specific line in front of you.',
  },
];

const VALID_MASTERS: MasterKey[] = COUNCIL.map((m) => m.key);

const PRESETS: Record<string, Partial<Record<MasterKey, number>>> = {
  'Heroic Clarity': { ogilvy: 40, campbell: 40, hemingway: 20 },
  'Quiet Authority': { hemingway: 50, byron_frankl: 30, musashi: 20 },
  'Conversion Flow': { ogilvy: 60, schwartz: 30, musashi: 10 },
  'Human Warmth': { byron_frankl: 50, hemingway: 30, campbell: 20 },
};

export interface MixResult {
  weights: Partial<Record<MasterKey, number>>;
  total: number;
  errors: string[];
  valid: boolean;
}

export function parseMix(mixString: string): MixResult {
  const errors: string[] = [];
  const weights: Partial<Record<MasterKey, number>> = {};

  if (mixString.includes(':')) {
    const parts = mixString.trim().split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const [key, val] = part.split(':');
      if (!VALID_MASTERS.includes(key as MasterKey)) {
        errors.push(`Unknown master: "${key}"`);
        continue;
      }
      weights[key as MasterKey] = Number(val);
    }
  } else {
    const keys = mixString.split('+').map((s) => s.trim()).filter(Boolean);
    for (const key of keys) {
      if (!VALID_MASTERS.includes(key as MasterKey)) errors.push(`Unknown master: "${key}"`);
    }
    const validKeys = keys.filter((k) => VALID_MASTERS.includes(k as MasterKey)) as MasterKey[];
    const base = Math.floor(100 / validKeys.length);
    const remainder = 100 - base * validKeys.length;
    validKeys.forEach((k, i) => {
      weights[k] = base + (i < remainder ? 1 : 0);
    });
  }

  const total = Object.values(weights).reduce((a: number, b) => a + (b ?? 0), 0);
  return { weights, total, errors, valid: errors.length === 0 && total === 100 };
}

export function resolvePreset(name: string): Partial<Record<MasterKey, number>> | null {
  return PRESETS[name] ?? null;
}

export interface CopyBrief {
  project: string;
  audience: string[];
  voice: string[];
  goal: string;
  style: string;
  seoKeywords: string[];
  pageType: string;
  brandStory: string;
}

export type CopyRequestResult =
  | { status: 'clarification_required'; missing: string[] }
  | { status: 'invalid_mix'; errors: string[] }
  | { status: 'unknown_preset'; presetName: string; availablePresets: string[] }
  | { status: 'ok'; assembledPrompt: string; weights: Partial<Record<MasterKey, number>> };

export class CopywrightCouncilBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  private validateBrief(brief: CopyBrief): string[] {
    const missing: string[] = [];
    if (!brief.project || brief.project.trim().length === 0) missing.push('project');
    if (!brief.audience || brief.audience.length === 0) missing.push('audience');
    if (!brief.goal || brief.goal.trim().length === 0) missing.push('goal');
    if (!brief.pageType || brief.pageType.trim().length === 0) missing.push('pageType');
    return missing;
  }

  private async finalize(brief: CopyBrief, weights: Partial<Record<MasterKey, number>>): Promise<CopyRequestResult> {
    const assembledPrompt = this.assemblePrompt(brief, weights);
    const result: CopyRequestResult = { status: 'ok', assembledPrompt, weights };
    await this.createDecision({ brief, weights }, { status: 'ok' }, 'copywright-council-v1');
    return result;
  }

  async requestMix(brief: CopyBrief, mixString: string): Promise<CopyRequestResult> {
    await this.enforcePermission('generate:copy-brief');

    const missing = this.validateBrief(brief);
    if (missing.length > 0) {
      const result: CopyRequestResult = { status: 'clarification_required', missing };
      await this.createDecision(brief, result, 'copywright-council-v1');
      return result;
    }

    const mixResult = parseMix(mixString);
    if (!mixResult.valid) {
      const result: CopyRequestResult = { status: 'invalid_mix', errors: mixResult.errors };
      await this.createDecision({ mixString }, result, 'copywright-council-v1');
      return result;
    }

    return this.finalize(brief, mixResult.weights);
  }

  async requestPreset(brief: CopyBrief, presetName: string): Promise<CopyRequestResult> {
    await this.enforcePermission('generate:copy-brief');

    const missing = this.validateBrief(brief);
    if (missing.length > 0) {
      const result: CopyRequestResult = { status: 'clarification_required', missing };
      await this.createDecision(brief, result, 'copywright-council-v1');
      return result;
    }

    const weights = resolvePreset(presetName);
    if (!weights) {
      const result: CopyRequestResult = {
        status: 'unknown_preset',
        presetName,
        availablePresets: Object.keys(PRESETS),
      };
      await this.createDecision({ presetName }, result, 'copywright-council-v1');
      return result;
    }

    return this.finalize(brief, weights);
  }

  private assemblePrompt(brief: CopyBrief, weights: Partial<Record<MasterKey, number>>): string {
    const activeMethods = COUNCIL.filter((m) => (weights[m.key] ?? 0) > 0)
      .map((m) => `- ${m.displayName} (${weights[m.key]}%): ${m.method}`)
      .join('\n');

    return [
      'You are the Copywright Council: a multi-voice copywriting intelligence blending the methods below at the given weights. Produce SEO-aligned, emotionally resonant, conversion-ready copy in the blended tone — headlines, subheads, body, and CTA.',
      '',
      'Active voices and weights:',
      activeMethods,
      '',
      `PROJECT: ${brief.project}`,
      `AUDIENCE: ${brief.audience.join(', ')}`,
      `VOICE: ${brief.voice.join(', ')}`,
      `GOAL: ${brief.goal}`,
      `STYLE: ${brief.style}`,
      `SEO KEYWORDS: ${brief.seoKeywords.join(', ')}`,
      `PAGE TYPE: ${brief.pageType}`,
      `BRAND STORY: ${brief.brandStory}`,
      '',
      'Output headlines, subheads, body copy, and a CTA, balanced according to the weighted voices above. Emotion earns trust. Clarity drives action. Rhythm holds attention. Story creates memory. Truth sustains loyalty. Simplicity reveals power.',
    ].join('\n');
  }
}
