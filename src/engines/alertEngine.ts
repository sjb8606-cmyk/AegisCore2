/**
 * Veridact v1.0 — Alert Engine
 */

import { v4 as uuidv4 } from 'uuid';
import type { PoolClient } from 'pg';
import { logger } from '../db/logger';
import { withTenant } from '../db/client';
import type { Actor, Alert, EventType, Severity } from '../types';
import { SEVERITY_MAP } from '../types';
import { AlertSchema } from '../schemas';
import { translate } from './translator';

interface TriggerAlertParams {
  tenantId: string;
  eventType: EventType;
  actor: Actor;
  message: string;
  linkedReceipt?: string;
  client: PoolClient;
}

export async function triggerAlert(params: TriggerAlertParams): Promise<Alert> {
  const { tenantId, eventType, actor, message, linkedReceipt, client } = params;

  const severity: Severity = SEVERITY_MAP[eventType];
  const humanMessage = translate(eventType);
  const alertId = uuidv4();
  const now = new Date().toISOString();

  const alert: Alert = {
    alert_id: alertId,
    tenant_id: tenantId,
    event_type: eventType,
    severity,
    message,
    actor,
    linked_receipt: linkedReceipt,
    timestamp: now,
    human_message: humanMessage,
  };

  const parsed = AlertSchema.safeParse(alert);
  if (!parsed.success) {
    logger.error({ errors: parsed.error.errors }, 'alert.schema_validation_failed');
    throw new Error(`Alert schema validation failed: ${parsed.error.message}`);
  }

  await client.query(
    `INSERT INTO alerts (
      alert_id, tenant_id, event_type, severity, message,
      human_message, actor, linked_receipt, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      alertId,
      tenantId,
      eventType,
      severity,
      message,
      humanMessage,
      JSON.stringify(actor),
      linkedReceipt ?? null,
    ]
  );

  const logPayload = {
    alert_id: alertId,
    event_type: eventType,
    severity,
    tenant_id: tenantId,
    linked_receipt: linkedReceipt,
    ...(severity === 'HIGH' ? { ALERT_HIGH: true } : {}),
  };

  if (severity === 'HIGH') {
    logger.warn(logPayload, 'alert.HIGH');
  } else if (severity === 'MEDIUM') {
    logger.info(logPayload, 'alert.MEDIUM');
  } else {
    logger.debug(logPayload, 'alert.LOW');
  }

  return alert;
}

export async function triggerReplayMismatchAlert(params: {
  tenantId: string;
  receiptId: string;
  actor: Actor;
}): Promise<Alert> {
  return withTenant(params.tenantId, async (client) => {
    return triggerAlert({
      tenantId: params.tenantId,
      eventType: 'replay_mismatch',
      actor: params.actor,
      message: `Replay mismatch detected for receipt ${params.receiptId}. Hash does not match original computation.`,
      linkedReceipt: params.receiptId,
      client,
    });
  });
}

interface ListAlertsParams {
  tenantId: string;
  page: number;
  limit: number;
  severity?: Severity;
  eventType?: EventType;
}

interface AlertRow {
  alert_id: string;
  tenant_id: string;
  event_type: string;
  severity: string;
  message: string;
  human_message: string;
  actor: Actor;
  linked_receipt?: string;
  created_at: Date;
}

function rowToAlert(row: AlertRow): Alert {
  return {
    alert_id: row.alert_id,
    tenant_id: row.tenant_id,
    event_type: row.event_type as EventType,
    severity: row.severity as Severity,
    message: row.message,
    actor: row.actor,
    linked_receipt: row.linked_receipt,
    timestamp: row.created_at.toISOString(),
    human_message: row.human_message,
  };
}

export async function listAlerts(
  params: ListAlertsParams
): Promise<{ rows: Alert[]; total: number }> {
  const { tenantId, page, limit, severity, eventType } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
  const values: unknown[] = [tenantId];
  let paramIndex = 2;

  if (severity) {
    conditions.push(`severity = $${paramIndex++}`);
    values.push(severity);
  }
  if (eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(eventType);
  }

  const where = conditions.join(' AND ');

  return withTenant(tenantId, async (client) => {
    const [dataRes, countRes] = await Promise.all([
      client.query<AlertRow>(
        `SELECT * FROM alerts WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset]
      ),
      client.query<{ count: string }>(`SELECT COUNT(*) as count FROM alerts WHERE ${where}`, values),
    ]);

    return {
      rows: dataRes.rows.map(rowToAlert),
      total: parseInt(countRes.rows[0].count, 10),
    };
  });
}
