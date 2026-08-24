/**
 * platform/ag-compliance-docs (AG-05)
 *
 * Certification registry + expiry alerts + inspection-prep report assembly.
 * Reads cycle/application data via injectable providers (AG-02 / AG-04).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('ag-compliance-docs');

const CertTypes = [
  'class_l_pesticide',
  'commercial_applicator',
  'rpap',
  'organic',
] as const;
export type CertType = (typeof CertTypes)[number];

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultExpiryWarningDays: z.number().int().positive().default(30),
});

export interface Certification {
  id: string;
  tenantId: string;
  certType: CertType;
  holderId: string;
  certNumber: string;
  issueDate: string;
  expiryDate: string;
  createdAt: string;
}

export interface InspectionPrepReport {
  id: string;
  tenantId: string;
  fieldIds: string[];
  dateRange: { from: string; to: string };
  certifications: Certification[];
  cycleSummaries: Array<{
    fieldId: string;
    cycleId: string;
    cropType: string;
    eventCount: number;
    status: string;
  }>;
  applicationRecords: Array<Record<string, unknown>>;
  generatedAt: string;
}

type CycleProvider = (
  tenantId: string,
  fieldIds: string[],
  from: string,
  to: string,
) => Promise<
  Array<{
    fieldId: string;
    cycleId: string;
    cropType: string;
    eventCount: number;
    status: string;
  }>
>;

type ApplicationProvider = (
  tenantId: string,
  fieldIds: string[],
  from: string,
  to: string,
) => Promise<Array<Record<string, unknown>>>;

const certs = new Map<string, Certification>();
const reports = new Map<string, InspectionPrepReport>();

let cycleProvider: CycleProvider = async () => [];
let applicationProvider: ApplicationProvider = async () => [];

export function __resetAgComplianceDocsStore(): void {
  certs.clear();
  reports.clear();
  cycleProvider = async () => [];
  applicationProvider = async () => [];
}

export function setCycleProvider(fn: CycleProvider): void {
  cycleProvider = fn;
}
export function setApplicationProvider(fn: ApplicationProvider): void {
  applicationProvider = fn;
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('ag-compliance-docs', ConfigSchema);
}

export async function registerCertification(
  tenantId: string,
  actorId: string,
  input: {
    certType: CertType;
    holderId: string;
    certNumber: string;
    issueDate: string;
    expiryDate: string;
  },
): Promise<Certification> {
  return runCrudOperation({
    configName: 'ag-compliance-docs',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!CertTypes.includes(input.certType)) {
        throw new AppError('invalid certType', ErrorCode.BAD_REQUEST);
      }
      if (!input.holderId?.trim() || !input.certNumber?.trim()) {
        throw new AppError(
          'holderId and certNumber required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const issue = Date.parse(input.issueDate);
      const expiry = Date.parse(input.expiryDate);
      if (Number.isNaN(issue) || Number.isNaN(expiry)) {
        throw new AppError('invalid dates', ErrorCode.BAD_REQUEST);
      }
      if (expiry <= issue) {
        throw new AppError(
          'expiryDate must be after issueDate',
          ErrorCode.BAD_REQUEST,
        );
      }
      const cert: Certification = {
        id: crypto.randomUUID(),
        tenantId,
        certType: input.certType,
        holderId: input.holderId.trim(),
        certNumber: input.certNumber.trim(),
        issueDate: new Date(issue).toISOString(),
        expiryDate: new Date(expiry).toISOString(),
        createdAt: new Date().toISOString(),
      };
      certs.set(cert.id, cert);
      return cert;
    },
    auditAction: 'data.created',
    auditResource: 'ag_certification',
    meterEventType: 'api_call',
  });
}

export async function getExpiringCertifications(
  tenantId: string,
  withinDays?: number,
): Promise<Certification[]> {
  const config = await loadCfg();
  const days = withinDays ?? config.defaultExpiryWarningDays;
  const now = Date.now();
  const horizon = now + days * 86_400_000;
  return [...certs.values()]
    .filter((c) => {
      if (c.tenantId !== tenantId) return false;
      const exp = Date.parse(c.expiryDate);
      return exp >= now && exp <= horizon;
    })
    .sort(
      (a, b) => Date.parse(a.expiryDate) - Date.parse(b.expiryDate),
    );
}

export async function isCertValid(
  tenantId: string,
  holderId: string,
  certType: CertType,
  at: Date = new Date(),
): Promise<boolean> {
  const t = at.getTime();
  return [...certs.values()].some(
    (c) =>
      c.tenantId === tenantId &&
      c.holderId === holderId &&
      c.certType === certType &&
      Date.parse(c.issueDate) <= t &&
      Date.parse(c.expiryDate) > t,
  );
}

export async function generateInspectionPrepReport(
  tenantId: string,
  actorId: string,
  input: {
    fieldIds: string[];
    dateRange: { from: string; to: string };
  },
): Promise<InspectionPrepReport> {
  return runCrudOperation({
    configName: 'ag-compliance-docs',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.fieldIds?.length) {
        throw new AppError('fieldIds required', ErrorCode.BAD_REQUEST);
      }
      const from = Date.parse(input.dateRange?.from);
      const to = Date.parse(input.dateRange?.to);
      if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
        throw new AppError('invalid dateRange', ErrorCode.BAD_REQUEST);
      }
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();

      const cycleSummaries = await cycleProvider(
        tenantId,
        input.fieldIds,
        fromIso,
        toIso,
      );
      const applicationRecords = await applicationProvider(
        tenantId,
        input.fieldIds,
        fromIso,
        toIso,
      );
      const certifications = [...certs.values()].filter(
        (c) => c.tenantId === tenantId,
      );

      const report: InspectionPrepReport = {
        id: crypto.randomUUID(),
        tenantId,
        fieldIds: input.fieldIds,
        dateRange: { from: fromIso, to: toIso },
        certifications,
        cycleSummaries,
        applicationRecords,
        generatedAt: new Date().toISOString(),
      };
      reports.set(report.id, report);
      logger.info(
        { reportId: report.id, fields: input.fieldIds.length },
        'Inspection prep report generated',
      );
      return report;
    },
    auditAction: 'data.read',
    auditResource: 'ag_inspection_report',
    meterEventType: 'api_call',
  });
}

export async function listCertifications(
  tenantId: string,
  holderId?: string,
): Promise<Certification[]> {
  return [...certs.values()].filter(
    (c) =>
      c.tenantId === tenantId &&
      (!holderId || c.holderId === holderId),
  );
}
