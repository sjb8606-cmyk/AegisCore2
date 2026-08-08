/**
 * platform/aegis-swarm/src/employees/negotiation-predictor.ts
 *
 * E-28 — Negotiation Predictor.
 *
 * Real core: Zone of Possible Agreement math (Fisher & Ury, "Getting
 * to Yes") — genuine negotiation theory, not fabricated psychology.
 * computeZopa() honestly returns null when the other party's max
 * acceptable point isn't actually known, rather than guessing.
 * Verified against a real-ZOPA case, a no-ZOPA case, and the unknown
 * case before implementation.
 *
 * Also assembles a fixed set of response-scenario branches (accept,
 * counter_higher, counter_lower, add_condition, walk_away) — same
 * "always all branches, no selection" pattern as Dreamer's fixed
 * 7-chamber sequence, since a real negotiation prep needs a
 * pre-built response for every realistic move, not just the likely
 * one. The actual counter-strategy content for each branch needs a
 * live LLM, same honest limit as every generation-shaped employee.
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

export interface NegotiationPosition {
  yourMinAcceptable: number;
  yourOpeningOffer: number;
  theirMaxAcceptable: number | null;
  theirOpeningOffer: number;
}

export interface ZopaResult {
  zopaExists: boolean | null;
  zopaRange: [number, number] | null;
  midpoint: number | null;
}

export function computeZopa(position: NegotiationPosition): ZopaResult {
  if (position.theirMaxAcceptable === null) {
    return { zopaExists: null, zopaRange: null, midpoint: null };
  }
  const zopaExists = position.yourMinAcceptable <= position.theirMaxAcceptable;
  const zopaRange: [number, number] | null = zopaExists ? [position.yourMinAcceptable, position.theirMaxAcceptable] : null;
  const midpoint = zopaExists ? (position.yourMinAcceptable + position.theirMaxAcceptable) / 2 : null;
  return { zopaExists, zopaRange, midpoint };
}

export type ResponseScenario = 'accept' | 'counter_higher' | 'counter_lower' | 'add_condition' | 'walk_away';

const ALL_SCENARIOS: ResponseScenario[] = ['accept', 'counter_higher', 'counter_lower', 'add_condition', 'walk_away'];

export interface NegotiationPrep {
  zopa: ZopaResult;
  assembledPrompt: string;
}

export class NegotiationPredictorBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async prepareNegotiation(position: NegotiationPosition, context: string): Promise<NegotiationPrep> {
    await this.enforcePermission('generate:negotiation-prep');

    const zopa = computeZopa(position);
    const assembledPrompt = this.assemblePrompt(position, zopa, context);

    await this.createDecision(
      { position },
      { zopaExists: zopa.zopaExists, midpoint: zopa.midpoint },
      'negotiation-predictor-v1',
    );

    return { zopa, assembledPrompt };
  }

  private assemblePrompt(position: NegotiationPosition, zopa: ZopaResult, context: string): string {
    const zopaLine =
      zopa.zopaExists === null
        ? "Their maximum acceptable point is unknown — treat it as a real unknown, don't guess a number."
        : zopa.zopaExists
          ? `A real Zone of Possible Agreement exists: ${zopa.zopaRange![0]} to ${zopa.zopaRange![1]}, midpoint ${zopa.midpoint}.`
          : 'No Zone of Possible Agreement currently exists based on the stated positions — the gap itself needs addressing before terms do.';

    const scenarioLines = ALL_SCENARIOS.map((s) => `- ${s}`).join('\n');

    return [
      'You are preparing for a real negotiation. Build a pre-planned counter-strategy for every realistic response the other party could make — not just the expected one.',
      '',
      `YOUR POSITION: min acceptable ${position.yourMinAcceptable}, opening offer ${position.yourOpeningOffer}`,
      `THEIR OPENING OFFER: ${position.theirOpeningOffer}`,
      zopaLine,
      `CONTEXT: ${context || 'none'}`,
      '',
      'For each of the following response scenarios, produce a specific, ready counter-offer or counter-move:',
      scenarioLines,
      '',
      "Ground every counter-strategy in the real ZOPA math above where it applies — don't recommend a number outside your stated minimum.",
    ].join('\n');
  }
}
