/**
 * apps/example-api/src/routes/privacy-controls.ts
 * Privacy Controls — per-user consent preferences.
 *
 * NOTE: this is a settings/singleton resource, not a collection, so the
 * shape deliberately deviates from the list/create/delete pattern:
 * GET returns my current preferences (defaulting to all-false if I've
 * never set any), PUT upserts them. There's nothing to paginate or
 * delete — "deleting" preferences would just mean resetting to
 * defaults, which PUT already covers.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, validateBody } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const UpdatePreferencesSchema = z.object({
  marketingOptIn:    z.boolean(),
  analyticsOptIn:    z.boolean(),
  dataSharingOptIn:  z.boolean(),
});

router.get('/items',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ marketing_opt_in: boolean; analytics_opt_in: boolean; data_sharing_opt_in: boolean; updated_at: string }>(
        `SELECT marketing_opt_in, analytics_opt_in, data_sharing_opt_in, updated_at FROM privacy_preferences WHERE user_id = $1`,
        [userId],
        tenantId,
      );

      const prefs = rows[0] || { marketing_opt_in: false, analytics_opt_in: false, data_sharing_opt_in: false, updated_at: null };

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'privacy_preferences', description: 'Read privacy preferences' });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, prefs);
    } catch (err) { next(err); }
  }
);

router.put('/items',
  requireRole(ROLES.VIEWER),
  validateBody(UpdatePreferencesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof UpdatePreferencesSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ marketing_opt_in: boolean; analytics_opt_in: boolean; data_sharing_opt_in: boolean; updated_at: string }>(
        `INSERT INTO privacy_preferences (tenant_id, user_id, marketing_opt_in, analytics_opt_in, data_sharing_opt_in)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET marketing_opt_in = EXCLUDED.marketing_opt_in, analytics_opt_in = EXCLUDED.analytics_opt_in, data_sharing_opt_in = EXCLUDED.data_sharing_opt_in, updated_at = CURRENT_TIMESTAMP
         RETURNING marketing_opt_in, analytics_opt_in, data_sharing_opt_in, updated_at`,
        [tenantId, userId, input.marketingOptIn, input.analyticsOptIn, input.dataSharingOptIn],
        tenantId,
      );

      const prefs = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.updated', outcome: 'success', resource: 'privacy_preferences', description: 'Updated privacy preferences' });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, prefs);
    } catch (err) { next(err); }
  }
);

export { router as privacyControlsRouter };
