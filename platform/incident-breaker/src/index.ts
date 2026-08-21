/**
 * platform/incident-breaker
 *
 * Severity triage + auto-suspend for liability-bearing flows.
 * Alert channels are recorded; real SMS/email/pagerduty adapters plug in later.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { setContractStatus, getContract } from '@platform/liability-contracts';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('incident-breaker');

const SeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoSuspendSeverities: z
    .array(SeveritySchema)
    .default(['HIGH', 'CRITICAL']),
  alertChannels: z
    .array(z.enum(['sms', 'email', 'pagerduty', 'log']))
    .default(['log']),
});

export type IncidentBreakerConfig = z.infer<typeof ConfigSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type TriageStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'dismissed';

export interface IncidentReport {
  id: string;
  tenantId: string;
  contractId: string | null;
  reporterId: string;
  subjectActorId: string | null;
  severity: Severity;
  description: string;
  immediateActionTaken: string | null;
  triageStatus: TriageStatus;
  autoSuspended: boolean;
  alertsFired: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SuspensionRecord {
  actorId: string;
  tenantId: string;
  reason: string;
  incidentId: string;
  suspendedAt: string;
}

const incidents = new Map<string, IncidentReport>();
const suspensions = new Map<string, SuspensionRecord>(); // actorId → record

export function __resetIncidentBreakerStore(): void {
  incidents.clear();
  suspensions.clear();
}

async function loadCfg(): Promise<IncidentBreakerConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('incident-breaker', ConfigSchema);
}

function fireAlerts(
  channels: string[],
  incident: IncidentReport,
): string[] {
  const fired: string[] = [];
  for (const ch of channels) {
    // Mock: log only. Real adapters (sms/email/pagerduty) later.
    logger.warn(
      {
        channel: ch,
        incidentId: incident.id,
        severity: incident.severity,
      },
      'Incident alert',
    );
    fired.push(ch);
  }
  return fired;
}

export async function fileIncident(
  tenantId: string,
  reporterId: string,
  input: {
    contractId?: string;
    subjectActorId?: string;
    severity: Severity;
    description: string;
    immediateActionTaken?: string;
  },
): Promise<IncidentReport> {
  return runCrudOperation({
    configName: 'incident-breaker',
    configSchema: ConfigSchema,
    tenantId,
    actorId: reporterId,
    action: async () => {
      const config = await loadCfg();
      if (!input.description?.trim()) {
        throw new AppError('description is required', ErrorCode.BAD_REQUEST);
      }
      const severity = SeveritySchema.parse(input.severity);

      if (input.contractId) {
        const c = await getContract(tenantId, input.contractId);
        if (!c) throw new AppError('Contract not found', ErrorCode.NOT_FOUND);
      }

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      let autoSuspended = false;
      const shouldSuspend = config.autoSuspendSeverities.includes(severity);

      if (shouldSuspend && input.subjectActorId) {
        suspensions.set(input.subjectActorId, {
          actorId: input.subjectActorId,
          tenantId,
          reason: `Auto-suspend on ${severity} incident`,
          incidentId: id,
          suspendedAt: now,
        });
        autoSuspended = true;
      }

      if (input.contractId && shouldSuspend) {
        try {
          await setContractStatus(
            tenantId,
            reporterId,
            input.contractId,
            'incident',
          );
        } catch {
          // contract status update best-effort
        }
      }

      const incident: IncidentReport = {
        id,
        tenantId,
        contractId: input.contractId || null,
        reporterId,
        subjectActorId: input.subjectActorId || null,
        severity,
        description: input.description.trim(),
        immediateActionTaken: input.immediateActionTaken || null,
        triageStatus: 'open',
        autoSuspended,
        alertsFired: [],
        createdAt: now,
        updatedAt: now,
      };
      incident.alertsFired = fireAlerts(config.alertChannels, incident);
      incidents.set(id, incident);

      logger.info(
        { incidentId: id, severity, autoSuspended },
        'Incident filed',
      );
      return incident;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'incident_report',
    meterEventType: 'api_call',
  });
}

export async function triageIncident(
  tenantId: string,
  staffId: string,
  incidentId: string,
  triageStatus: TriageStatus,
): Promise<IncidentReport> {
  return runCrudOperation({
    configName: 'incident-breaker',
    configSchema: ConfigSchema,
    tenantId,
    actorId: staffId,
    action: async () => {
      const incident = incidents.get(incidentId);
      if (!incident || incident.tenantId !== tenantId) {
        throw new AppError('Incident not found', ErrorCode.NOT_FOUND);
      }
      incident.triageStatus = triageStatus;
      incident.updatedAt = new Date().toISOString();
      incidents.set(incidentId, incident);
      return incident;
    },
    auditAction: 'data.updated',
    auditResource: 'incident_report',
    meterEventType: 'api_call',
  });
}

export async function getIncident(
  tenantId: string,
  incidentId: string,
): Promise<IncidentReport | null> {
  const i = incidents.get(incidentId);
  if (!i || i.tenantId !== tenantId) return null;
  return i;
}

export async function listIncidents(
  tenantId: string,
  filter?: { contractId?: string; triageStatus?: TriageStatus },
): Promise<IncidentReport[]> {
  return [...incidents.values()].filter(
    (i) =>
      i.tenantId === tenantId &&
      (!filter?.contractId || i.contractId === filter.contractId) &&
      (!filter?.triageStatus || i.triageStatus === filter.triageStatus),
  );
}

export function isActorSuspended(
  tenantId: string,
  actorId: string,
): boolean {
  const s = suspensions.get(actorId);
  return !!(s && s.tenantId === tenantId);
}

export function getSuspension(
  tenantId: string,
  actorId: string,
): SuspensionRecord | null {
  const s = suspensions.get(actorId);
  if (!s || s.tenantId !== tenantId) return null;
  return s;
}
