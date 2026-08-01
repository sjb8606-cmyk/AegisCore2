import { z } from 'zod';
import { getPool } from '../../tenancy/src/rls';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const CreateTenantInputSchema = z.object({
  name: z.string().min(1),
  preferredLanguage: z.enum(['en', 'fr']).default('en'),
});

export class TenantOnboardingService {
  static async createTenant(oidcSub: string, data: any) {
    if (!oidcSub) {
      throw new AppError('Missing authenticated user subject', ErrorCode.UNAUTHORIZED);
    }
    const input = CreateTenantInputSchema.parse(data);

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
