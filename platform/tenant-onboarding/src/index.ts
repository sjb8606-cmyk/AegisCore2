import { z } from 'zod';
import { getPool } from '../../tenancy/src/rls';
import { AppError, ErrorCode } from '../../utils/src/index';
import { listDeclaredApps } from '../../app-loader/src/config';
export { AppError, ErrorCode };

export const CreateTenantInputSchema = z.object({
  name: z.string().min(1),
  preferredLanguage: z.enum(['en', 'fr']).default('en'),
  // Explicit and required, on purpose: every real onboarding here is a
  // deliberate, known, back-office action (a specific customer being
  // provisioned for a specific product already sold) — not a self-serve
  // signup that needs to infer which app from a subdomain or invite code.
  // If a genuine self-serve flow is ever built, layer inference on top of
  // this explicit field then — don't guess at it now.
  app_id: z.string().min(1),
});

export class TenantOnboardingService {
  static async createTenant(oidcSub: string, data: any) {
    if (!oidcSub) {
      throw new AppError('Missing authenticated user subject', ErrorCode.UNAUTHORIZED);
    }
    const input = CreateTenantInputSchema.parse(data);

    if (!listDeclaredApps().includes(input.app_id)) {
      throw new AppError(
        `Unknown app_id "${input.app_id}" — no matching config/apps/${input.app_id}.json`,
        ErrorCode.BAD_REQUEST,
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT tenant_id FROM tenant_members WHERE oidc_sub = $1',
        [oidcSub]
      );
      if (existing.rows.length > 0) {
        throw new AppError('This user already belongs to a tenant.', ErrorCode.CONFLICT);
      }

      const tenantRes = await client.query(
        'INSERT INTO tenants (name, preferred_language) VALUES ($1, $2) RETURNING *',
        [input.name, input.preferredLanguage]
      );
      const tenant = tenantRes.rows[0];

      await client.query(
        'INSERT INTO tenant_members (tenant_id, oidc_sub, role) VALUES ($1, $2, $3)',
        [tenant.id, oidcSub, 'tenant_admin']
      );

      // Atomic with the two inserts above, on purpose: a tenant must never
      // exist — even briefly — without an app assignment. Without this,
      // the tenant's very first authenticated request after onboarding
      // would hit resolveAppIdForTenant()'s real NOT_FOUND throw (verified
      // against platform/app-loader/src/tenant-router.ts — it does not
      // fail silently).
      await client.query(
        'INSERT INTO tenant_apps (tenant_id, app_id) VALUES ($1, $2)',
        [tenant.id, input.app_id]
      );

      await client.query('COMMIT');
      return tenant;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getTenantForUser(oidcSub: string) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT t.* FROM tenants t
       JOIN tenant_members tm ON tm.tenant_id = t.id
       WHERE tm.oidc_sub = $1 AND t.deleted_at IS NULL`,
      [oidcSub]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
  }
}
