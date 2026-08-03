/**
 * platform/bot-registry/src/schema.ts
 *
 * Canonical shape of an AegisSwarm bot definition. Every bot in the
 * swarm — hunter, repair, defense, red team, DevOps — is one JSON file
 * validated against this schema. No bot runs without passing validation.
 */

import { z } from 'zod';

// ── Adversarial Fingerprint List ────────────────────────────────
// Any bot spec containing these strings anywhere in its content is
// rejected immediately, no exceptions. Ported directly from the
// CrystalForge Replicator's structural-incapacity rules.

export const ADVERSARIAL_FINGERPRINTS: readonly string[] = [
  'bypass_hitl',
  'modify_governance',
  'expand_identity',
  'disable_watchdog',
  'root_access',
  'unfiltered_egress',
  'direct_db_write_rls_off',
] as const;

// ── Core Schema ──────────────────────────────────────────────────

export const HitlClassification = z.enum([
  'Logging',
  'Alert',
  'Synchronous Gate',
]);
export type HitlClassification = z.infer<typeof HitlClassification>;

export const BotAncestrySchema = z.object({
  sourceSignals: z.array(z.string()).min(1),
  adversarialFingerprintMatch: z.literal(false),
});

export const BotOutputContractSchema = z.object({
  findings: z.array(z.record(z.unknown())).optional(),
  fixes: z.array(z.record(z.unknown())).optional(),
  piScore: z.string().optional(),
  gateStatus: z.enum(['PASS', 'FAIL']).optional(),
  humanReport: z.string().optional(),
}).partial();

// ── Persona (conversational layer) ──────────────────────────────
// Optional — same conceptual pattern as Delight Engine personas, but
// attached to a bot spec instead of a chat character. A bot with no
// persona still works exactly as before; this only enables
// CrystalBot.explainDecision() to speak in a consistent voice.

export const BotPersonaSchema = z.object({
  name: z.string().min(1),
  voice: z.string().min(1),
  tone: z.string().min(1),
});
export type BotPersona = z.infer<typeof BotPersonaSchema>;

export const BotSpecificationSchema = z.object({
  version: z.literal('1.0'),
  proposedBotId: z.string().regex(/^[DR]-\d{2}$/, 'Bot ID must be format D-XX or R-XX'),
  role: z.string().min(10).max(500),
  triggerConditions: z.array(z.string()).min(1),
  behaviorDescription: z.string().min(50),
  permissionScope: z.array(z.string()).min(1),
  hitlClassification: HitlClassification,
  ancestry: BotAncestrySchema,
  outputContract: BotOutputContractSchema.optional(),
  hardStops: z.array(z.string()).optional(),
  persona: BotPersonaSchema.optional(),
});

export type BotSpecification = z.infer<typeof BotSpecificationSchema>;

// ── Validation Result ────────────────────────────────────────────

export type BotValidationResult =
  | { valid: true; bot: BotSpecification; filePath: string }
  | { valid: false; filePath: string; reason: string };

/**
 * Checks raw file content for adversarial fingerprints BEFORE schema
 * parsing. This runs on the raw string, not the parsed object, so a
 * fingerprint hidden in a nested field can't slip past.
 */
export function containsAdversarialFingerprint(rawContent: string): string | null {
  const lower = rawContent.toLowerCase();
  for (const fingerprint of ADVERSARIAL_FINGERPRINTS) {
    if (lower.includes(fingerprint.toLowerCase())) {
      return fingerprint;
    }
  }
  return null;
}
