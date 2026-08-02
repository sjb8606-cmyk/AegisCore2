/**
 * apps/example-api/src/routes/iot-alerts.ts
 *
 * IoT Alerts — device-generated alerts for tenant-wide visibility.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantQuery } from '../../../../platform/tenancy/src/index';
import { emit as auditEmit } from '../../../../platform/audit/src/index';
import { recordUsage } from '../../../../platform/metering/src/index';
import { requireRole, ROLES } from '../../../../platform/auth/src/index';
import { ok, created, validateBody, validateQuery, AppError, ErrorCode } from '../../../../platform/utils/src/index';
import { PaginationQuerySchema, buildPage, handleETag, decodeCursor } from '../../../../platform/utils/src/index';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

const router = Router();

const CreateAlertSchema = z.object({
  deviceId:  z.string().uuid(),
  alertType: z.string().min(1).max(100),
  severity:  z.enum(['info', 'warning', 'critical']).default('info'),
  message:   z.string().min(1).max(2000),
});

const AlertIdParamSchema = z.object({ id: z.string().uuid() });

// ── GET /items — list IoT alerts (paginated + ETag) ─────────────

router.get('/items',
  requireRole(ROLES.VIEWER),
  validateQuery(PaginationQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const query = (req as any).validatedQuery;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;
      const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null;

      const rows = await withTenantQuery<{ id: string; device_id: string; alert_type: string; severity: string; message: string; acknowledged_at: string | null; created_at: string }>(
        `SELECT id, device_id, alert_type, severity, message, acknowledged_at, created_at FROM iot_alerts
         WHERE ($1::timestamptz IS NULL OR created_at ${query.sort === 'asc' ? '>' : '<'} $1::timestamptz)
         ORDER BY created_at ${query.sort === 'asc' ? 'ASC' : 'DESC'}
         LIMIT $2`,
        [cursorFilter, query.limit + 1],
        tenantId,
      );

      const page = buildPage(rows, 'created_at', query);
      if (handleETag(req, res, page)) return;

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.read', outcome: 'success', resource: 'iot_alert', description: `Listed IoT alerts (page cursor: ${query.cursor || 'start'})` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, page.data, { pagination: page.pagination });
    } catch (err) { next(err); }
  }
);

// ── POST /items — record a device alert ─────────────────────────

router.post('/items',
  requireRole(ROLES.VIEWER),
  validateBody(CreateAlertSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const input = req.body as z.infer<typeof CreateAlertSchema>;
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string; device_id: string; alert_type: string; severity: string; message: string; acknowledged_at: string | null; created_at: string }>(
        `INSERT INTO iot_alerts (tenant_id, device_id, alert_type, severity, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, device_id, alert_type, severity, message, acknowledged_at, created_at`,
        [tenantId, input.deviceId, input.alertType, input.severity, input.message],
        tenantId,
      );

      const alert = rows[0];

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.created', outcome: 'success', resource: 'iot_alert', resourceId: alert.id, description: `Device ${input.deviceId} raised ${input.severity} alert: ${input.alertType}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${alert.id}` });

      return created(res, alert);
    } catch (err) { next(err); }
  }
);

// ── DELETE /items/:id — dismiss an alert ─────────────────────────

router.delete('/items/:id',
  requireRole(ROLES.VIEWER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = AlertIdParamSchema.parse({ id: req.params.id });
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.sub;

      const rows = await withTenantQuery<{ id: string }>(
        `DELETE FROM iot_alerts WHERE id = $1 RETURNING id`,
        [id],
        tenantId,
      );

      if (rows.length === 0) {
        return next(new AppError('Alert not found', ErrorCode.NOT_FOUND));
      }

      await auditEmit({ tenantId, actorId: userId, actorType: 'user', action: 'data.deleted', outcome: 'success', resource: 'iot_alert', resourceId: id, description: `Dismissed alert ${id}` });
      await recordUsage({ tenantId, actorId: userId, eventType: 'api_call', quantity: 1, idempotencyKey: `api:${req.method}:${req.path}:${Date.now()}` });

      return ok(res, { id });
    } catch (err) { next(err); }
  }
);

export { router as iotAlertsRouter };
