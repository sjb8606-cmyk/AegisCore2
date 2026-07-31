/**
 * Veridact — Policy Bundle Store (DB-backed)
 *
 * Persists PolicyBundles to the policy_bundles table, RLS-scoped by tenant
 * via withTenant(). Replaces the earlier in-memory Map — that version had a
 * real multi-tenancy gap: it keyed bundles by rules_version ALONE, so two
 * tenants using the same version string would silently overwrite each
 * other's rules. The DB table's primary key is (tenant_id, rules_version),
 * so tenantId is now a required, explicit parameter everywhere.
 *
 * registerBundle uses an upsert (ON CONFLICT DO UPDATE) — re-registering the
 * same tenant_id + rules_version updates in place (and un-soft-deletes it),
 * which is also what makes repeated test runs against a real DB safe.
 */

import crypto from 'crypto';
import { withTenant } from '../db/client';
import type { PolicyBundle } from '../types/policy';

function hashBundle(bundle: Omit<PolicyBundle, 'rules_hash'>): string {
  const sorted = JSON.stringify(
    Object.fromEntries(Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)))
  );
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

export class PolicyBundleNotFoundError extends Error {
  statusCode = 400;
  constructor(tenantId: string, rulesVersion: string) {
    super(`No policy bundle registered for tenant "${tenantId}", rules_version "${rulesVersion}"`);
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

function rowToBundle(row: Record<string, unknown>): PolicyBundle {
  return {
    rules_version: row.rules_version as string,
    rules_hash: row.rules_hash as string,
    default_effect: row.default_effect as PolicyBundle['default_effect'],
    rules: row.rules as PolicyBundle['rules'],
  };
}

export async function registerBundle(
  tenantId: string,
  bundle: Omit<PolicyBundle, 'rules_hash'>
): Promise<PolicyBundle> {
  const rules_hash = hashBundle(bundle);

  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `INSERT INTO policy_bundles (tenant_id, rules_version, rules_hash, default_effect, rules)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, rules_version)
       DO UPDATE SET
         rules_hash = EXCLUDED.rules_hash,
         default_effect = EXCLUDED.default_effect,
         rules = EXCLUDED.rules,
         deleted_at = NULL
       RETURNING rules_version, rules_hash, default_effect, rules`,
      [tenantId, bundle.rules_version, rules_hash, bundle.default_effect, JSON.stringify(bundle.rules)]
    );
    return rowToBundle(res.rows[0]);
  });
}

export async function getPolicyBundle(
  tenantId: string,
  rulesVersion: string,
  rulesHash: string
): Promise<PolicyBundle> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<Record<string, unknown>>(
      `SELECT rules_version, rules_hash, default_effect, rules
       FROM policy_bundles
       WHERE tenant_id = $1 AND rules_version = $2 AND deleted_at IS NULL`,
      [tenantId, rulesVersion]
    );

    if (res.rows.length === 0) {
      throw new PolicyBundleNotFoundError(tenantId, rulesVersion);
    }

    const bundle = rowToBundle(res.rows[0]);
    if (bundle.rules_hash !== rulesHash) {
      throw new PolicyBundleHashMismatchError(rulesVersion, bundle.rules_hash, rulesHash);
    }
    return bundle;
  });
}

export async function getBundleHash(tenantId: string, rulesVersion: string): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<{ rules_hash: string }>(
      `SELECT rules_hash FROM policy_bundles
       WHERE tenant_id = $1 AND rules_version = $2 AND deleted_at IS NULL`,
      [tenantId, rulesVersion]
    );
    return res.rows.length > 0 ? res.rows[0].rules_hash : null;
  });
}
