/**
 * platform/fisheries/loss-alert/src/index.ts
 */

import { z } from 'zod';
import { withTenantQuery } from '../../../tenancy/src/index';
import { loadConfig, AppError, ErrorCode } from '../../../utils/src/index';
import { SpeciesRegistryService } from '../../species-registry/src/index';
import { NotificationService } from '../../../notifications/src/index';
export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  alertRecipient: z.string().email(),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function getConfig() {
  return loadConfig('fisheries-loss-alert', ConfigSchema);
}

export class LossAlertService {
  static async sendLossAlert(tenantId: string, yieldRecordId: string, userId: string) {
    const config = getConfig();
    if (!config.enabled) {
      throw new AppError('Loss alerts disabled', ErrorCode.FORBIDDEN);
    }
    parseUserId(userId);

    const recordRes = await withTenantQuery(
      'SELECT * FROM fisheries_yield_records WHERE tenant_id = $1 AND id = $2',
      [tenantId, yieldRecordId],
      tenantId
    );
    if (!recordRes || recordRes.length === 0) {
      throw new AppError(`Yield record ${yieldRecordId} not found`, ErrorCode.NOT_FOUND);
    }
    const record = recordRes[0];

    if (!record.is_underperforming) {
      throw new AppError(
        `Yield record ${yieldRecordId} is not flagged as underperforming — no alert needed.`,
        ErrorCode.BAD_REQUEST
      );
    }

    const existingAlert = await withTenantQuery(
      'SELECT id FROM fisheries_loss_alerts WHERE tenant_id = $1 AND yield_record_id = $2 LIMIT 1',
      [tenantId, yieldRecordId],
      tenantId
    );
    if (existingAlert && existingAlert.length > 0) {
      throw new AppError(`An alert has already been sent for yield record ${yieldRecordId}.`, ErrorCode.CONFLICT);
    }

    const species = await SpeciesRegistryService.getSpecies(tenantId, record.species_id);

    const subject = `Yield Alert: ${species.common_name} batch underperforming`;
    const body = `Batch yield for ${species.common_name} came in at ${record.actual_yield_percent}%, ` +
      `${Math.abs(Number(record.deviation_points))} points below the ${record.baseline_yield_percent}% baseline. ` +
      `Batch ID: ${record.batch_id}.`;

    const notifyResult = await NotificationService.send(tenantId, {
      recipient: config.alertRecipient,
      channel: 'email',
      subject,
      body,
    });

    const res = await withTenantQuery(
      `INSERT INTO fisheries_loss_alerts (
        tenant_id, yield_record_id, species_id, notification_success, notification_log_id
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [tenantId, yieldRecordId, record.species_id, notifyResult.success, notifyResult.logId ?? null],
      tenantId
    );

    return res[0];
  }

  static async listAlerts(tenantId: string, filters: { speciesId?: string } = {}) {
    const conditions: string[] = ['tenant_id = $1'];
    const values: any[] = [tenantId];

    if (filters.speciesId) {
      conditions.push('species_id = $2');
      values.push(filters.speciesId);
    }

    const sql = `
      SELECT * FROM fisheries_loss_alerts
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
    `;

    return await withTenantQuery(sql, values, tenantId);
  }
}
