/**
 * platform/aegis-swarm/src/lib/incident-store.ts
 *
 * Real, tenant-scoped (RLS-protected) storage for D-14's incident
 * lifecycle. Timeline entries are appended atomically via Postgres's
 * JSONB `||` concatenation operator in a single UPDATE — never a
 * read-modify-write from application code, which would race under
 * concurrent appends.
 *
 * Status transitions are guarded at the SQL level via `status =
 * ANY($allowedFromStatuses)`, the same principle as
 * bot-runtime's updateDecisionStatus() and purge-store's
 * cancelPurge()/executePurge() — enforced in the database, not just
 * application logic.
 *
 * Table: migrations/sql/V268__create_security_incidents.sql
 */

import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';

export type IncidentStatus = 'open' | 'investigating' | 'resolved';

export interface TimelineEntry {
  type: string;
  detail: string;
  timestamp: string;
}

export interface SecurityIncident {
  id: string;
  tenantId: string;
  category: string;
  description: string;
  status: IncidentStatus;
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
}

// Which "from" statuses are allowed to reach each target status.
// Nothing ever transitions back to 'open' — an incident is either
// still open, actively being investigated, or resolved. Exported so
// other code (e.g. R-13) can analyze this exact, live transition map
// directly, rather than duplicating a copy that could drift out of
// sync with the real one.
export const ALLOWED_FROM: Record<IncidentStatus, IncidentStatus[]> = {
  open: [],
  investigating: ['open'],
  resolved: ['open', 'investigating'],
};

function mapRow(row: any): SecurityIncident {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    category: row.category,
    description: row.description,
    status: row.status,
    timeline: row.timeline ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function openIncident(
  tenantId: string,
  category: string,
  description: string,
): Promise<SecurityIncident> {
  const id = randomUUID();
  const openedEntry: TimelineEntry = { type: 'opened', detail: description, timestamp: new Date().toISOString() };

  const rows = await withTenantQuery(
    `INSERT INTO security_incidents (id, tenant_id, category, description, status, timeline)
     VALUES ($1, $2, $3, $4, 'open', $5::jsonb)
     RETURNING id, tenant_id, category, description, status, timeline, created_at, updated_at`,
    [id, tenantId, category, description, JSON.stringify([openedEntry])],
    tenantId,
  );

  return mapRow(rows[0]);
}

export async function getIncident(tenantId: string, incidentId: string): Promise<SecurityIncident | null> {
  const rows = await withTenantQuery(
    `SELECT id, tenant_id, category, description, status, timeline, created_at, updated_at
     FROM security_incidents
     WHERE id = $1`,
    [incidentId],
    tenantId,
  );

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function appendTimelineEvent(
  tenantId: string,
  incidentId: string,
  eventType: string,
  detail: string,
): Promise<boolean> {
  const entry: TimelineEntry = { type: eventType, detail, timestamp: new Date().toISOString() };

  const rows = await withTenantQuery(
    `UPDATE security_incidents
     SET timeline = timeline || $2::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [incidentId, JSON.stringify([entry])],
    tenantId,
  );

  return rows.length > 0;
}

export async function updateIncidentStatus(
  tenantId: string,
  incidentId: string,
  newStatus: IncidentStatus,
): Promise<boolean> {
  const allowedFrom = ALLOWED_FROM[newStatus];
  if (allowedFrom.length === 0) return false;

  const entry: TimelineEntry = {
    type: 'status_changed',
    detail: `Status changed to ${newStatus}`,
    timestamp: new Date().toISOString(),
  };

  const rows = await withTenantQuery(
    `UPDATE security_incidents
     SET status = $2, timeline = timeline || $3::jsonb, updated_at = NOW()
     WHERE id = $1 AND status = ANY($4::text[])
     RETURNING id`,
    [incidentId, newStatus, JSON.stringify([entry]), allowedFrom],
    tenantId,
  );

  return rows.length > 0;
}
