/**
 * Veridact — Policy Bundle Store
 *
 * In-memory registry of PolicyBundles, keyed by rules_version.
 * rules_hash is verified on every lookup: a caller's claimed rules_hash must
 * match the hash of the bundle actually registered under that version.
 * This preserves the "rules_hash on every receipt" integrity guarantee —
 * a receipt's rules_hash always identifies one exact, unambiguous rule set.
 *
 * SWAP: replace with a DB-backed or config-file-backed loader once the
 * questionnaire → skin compiler exists and tenants have their own bundles.
 */

import crypto from 'crypto';
import type { PolicyBundle } from '../types/policy';

function hashBundle(bundle: Omit<PolicyBundle, 'rules_hash'>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)))
  );
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

const BUNDLES = new Map<string, PolicyBundle>();

function registerBundle(bundle: Omit<PolicyBundle, 'rules_hash'>): PolicyBundle {
  const rules_hash = hashBundle(bundle);
  const full: PolicyBundle = { ...bundle, rules_hash };
  BUNDLES.set(bundle.rules_version, full);
  return full;
}

// ─── Default / example bundle ──────────────────────────────────────────────
// Placeholder until the questionnaire → skin compiler produces tenant-specific bundles.
registerBundle({
  rules_version: '1.0.0',
  default_effect: 'DENY',
  rules: [
    {
      rule_id: 'no-medical-advice',
      description: 'Block medical advice questions',
      priority: 1,
      conditions: [{ field: 'topic', operator: 'eq', value: 'medical_advice' }],
      effect: 'DENY',
      reason: 'AI is not authorized to give medical advice.',
    },
    {
      rule_id: 'allow-appointment-scheduling',
      description: 'Allow scheduling requests',
      priority: 2,
      conditions: [{ field: 'topic', operator: 'eq', value: 'appointment' }],
      effect: 'ALLOW',
      reason: 'Scheduling is within the allowed boundary.',
    },
  ],
});

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PolicyBundleNotFoundError extends Error {
  statusCode = 400;
  constructor(rulesVersion: string) {
    super(`No policy bundle registered for rules_version "${rulesVersion}"`);
    this.name = 'PolicyBundleNotFoundError';
  }
}

export class PolicyBundleHashMismatchError extends Error {
  statusCode = 400;
  constructor(rulesVersion: string, expected: string, actual: string) {
    super(
      `rules_hash mismatch for rules_version "${rulesVersion}": expected ${expected}, got ${actual}`
    );
    this.name = 'PolicyBundleHashMismatchError';
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getPolicyBundle(rulesVersion: string, rulesHash: string): PolicyBundle {
  const bundle = BUNDLES.get(rulesVersion);
  if (!bundle) {
    throw new PolicyBundleNotFoundError(rulesVersion);
  }
  if (bundle.rules_hash !== rulesHash) {
    throw new PolicyBundleHashMismatchError(rulesVersion, bundle.rules_hash, rulesHash);
  }
  return bundle;
}

export function getBundleHash(rulesVersion: string): string | null {
  return BUNDLES.get(rulesVersion)?.rules_hash ?? null;
}

export { registerBundle };
