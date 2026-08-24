/**
 * platform/aq-containment (AQ-04)
 *
 * Containment inspections + escape incidents.
 * Reportable threshold: ≥50 escaped finfish — flags for human review,
 * never auto-submits to regulator.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('aq-containment');

const InspectionTypes = [
  'net_integrity',
  'mooring',
  'predator_exclusion',
] as const;
export type InspectionType = (typeof InspectionTypes)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reportableEscapeCountFinfish: z.number().int().positive().default(50),
});

export type InspectionStatus = 'scheduled' | 'completed' | 'overdue';

export interface Inspection {
  id: string;
  tenantId: string;
  siteId: string;
  holdingUnitId: string | null;
  inspectionType: InspectionType;
  dueDate: string;
  status: InspectionStatus;
  passed: boolean | null;
  findings: string | null;
  photoUrls: string[];
  completedAt: string | null;
  actorId: string;
  createdAt: string;
}

export interface EscapeIncident {
  id: string;
  tenantId: string;
  siteId: string;
  estimatedCount: number;
  species: string;
  cause: string;
  reportable: boolean;
  reviewStatus: 'pending_review' | 'submitted' | 'cleared';
  createdAt: string;
  actorId: string;
}

const inspections = new Map<string, Inspection>();
const escapes = new Map<string, EscapeIncident>();

export function __resetAqContainmentStore(): void {
  inspections.clear();
  escapes.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('aq-containment', ConfigSchema);
}

function refreshOverdue(insp: Inspection): Inspection {
  if (
    insp.status === 'scheduled' &&
    Date.parse(insp.dueDate) < Date.now()
  ) {
    return { ...insp, status: 'overdue' };
  }
  return insp;
}

export async function scheduleInspection(
  tenantId: string,
  actorId: string,
  input: {
    siteId: string;
    holdingUnitId?: string;
    inspectionType: InspectionType;
    dueDate: string;
  },
): Promise<Inspection> {
  return runCrudOperation({
    configName: 'aq-containment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.siteId?.trim()) {
        throw new AppError('siteId required', ErrorCode.BAD_REQUEST);
      }
      if (!InspectionTypes.includes(input.inspectionType)) {
        throw new AppError('invalid inspectionType', ErrorCode.BAD_REQUEST);
      }
      const due = Date.parse(input.dueDate);
      if (Number.isNaN(due)) {
        throw new AppError('invalid dueDate', ErrorCode.BAD_REQUEST);
      }
      const insp: Inspection = {
        id: crypto.randomUUID(),
        tenantId,
        siteId: input.siteId,
        holdingUnitId: input.holdingUnitId?.trim() || null,
        inspectionType: input.inspectionType,
        dueDate: new Date(due).toISOString(),
        status: 'scheduled',
        passed: null,
        findings: null,
        photoUrls: [],
        completedAt: null,
        actorId,
        createdAt: new Date().toISOString(),
      };
      inspections.set(insp.id, insp);
      return insp;
    },
    auditAction: 'data.created',
    auditResource: 'aq_inspection',
    meterEventType: 'api_call',
  });
}

export async function logInspectionResult(
  tenantId: string,
  actorId: string,
  input: {
    inspectionId: string;
    passed: boolean;
    findings?: string;
    photoUrls?: string[];
  },
): Promise<Inspection> {
  return runCrudOperation({
    configName: 'aq-containment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const insp = inspections.get(input.inspectionId);
      if (!insp || insp.tenantId !== tenantId) {
        throw new AppError('Inspection not found', ErrorCode.NOT_FOUND);
      }
      if (insp.status === 'completed') {
        throw new AppError('Inspection already completed', ErrorCode.CONFLICT);
      }
      insp.passed = !!input.passed;
      insp.findings = input.findings?.trim() || null;
      insp.photoUrls = input.photoUrls || [];
      insp.status = 'completed';
      insp.completedAt = new Date().toISOString();
      inspections.set(insp.id, insp);
      logger.info(
        { inspectionId: insp.id, passed: insp.passed },
        'Inspection completed',
      );
      return insp;
    },
    auditAction: 'data.updated',
    auditResource: 'aq_inspection',
    meterEventType: 'api_call',
  });
}

export async function logEscapeIncident(
  tenantId: string,
  actorId: string,
  input: {
    siteId: string;
    estimatedCount: number;
    species: string;
    cause: string;
  },
): Promise<EscapeIncident> {
  return runCrudOperation({
    configName: 'aq-containment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.siteId?.trim() || !input.species?.trim() || !input.cause?.trim()) {
        throw new AppError(
          'siteId, species, cause required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (
        typeof input.estimatedCount !== 'number' ||
        input.estimatedCount < 0
      ) {
        throw new AppError(
          'estimatedCount must be >= 0',
          ErrorCode.BAD_REQUEST,
        );
      }
      const reportable =
        input.estimatedCount >= config.reportableEscapeCountFinfish;
      const incident: EscapeIncident = {
        id: crypto.randomUUID(),
        tenantId,
        siteId: input.siteId,
        estimatedCount: input.estimatedCount,
        species: input.species.trim(),
        cause: input.cause.trim(),
        reportable,
        reviewStatus: reportable ? 'pending_review' : 'cleared',
        createdAt: new Date().toISOString(),
        actorId,
      };
      escapes.set(incident.id, incident);
      if (reportable) {
        logger.warn(
          {
            incidentId: incident.id,
            count: incident.estimatedCount,
          },
          'Reportable escape — pending human review (not auto-submitted)',
        );
      }
      return incident;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'aq_escape_incident',
    meterEventType: 'api_call',
  });
}

export async function getInspectionSchedule(
  tenantId: string,
  siteId: string,
): Promise<Inspection[]> {
  return [...inspections.values()]
    .filter((i) => i.tenantId === tenantId && i.siteId === siteId)
    .map(refreshOverdue)
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
}

export async function listEscapeIncidents(
  tenantId: string,
  siteId?: string,
): Promise<EscapeIncident[]> {
  return [...escapes.values()].filter(
    (e) =>
      e.tenantId === tenantId && (!siteId || e.siteId === siteId),
  );
}

export async function markEscapeReviewed(
  tenantId: string,
  actorId: string,
  incidentId: string,
  status: 'submitted' | 'cleared',
): Promise<EscapeIncident> {
  return runCrudOperation({
    configName: 'aq-containment',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const incident = escapes.get(incidentId);
      if (!incident || incident.tenantId !== tenantId) {
        throw new AppError('Incident not found', ErrorCode.NOT_FOUND);
      }
      incident.reviewStatus = status;
      escapes.set(incidentId, incident);
      return incident;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'aq_escape_incident',
    meterEventType: 'api_call',
  });
}
