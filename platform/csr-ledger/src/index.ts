/**
 * platform/csr-ledger
 *
 * Volunteer hours pledged vs logged per CSR partner / employee.
 * logHours typically called when a planner_shift completes for a CSR-tagged actor.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getPartner } from '@platform/csr-partners';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('csr-ledger');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireShiftId: z.boolean().default(false),
});

export interface CsrHourEntry {
  id: string;
  tenantId: string;
  csrPartnerId: string;
  employeeActorId: string;
  hoursLogged: number;
  shiftId: string | null;
  contractId: string | null;
  verified: boolean;
  periodKey: string; // YYYY-MM or YYYY-Qn
  createdAt: string;
}

const entries = new Map<string, CsrHourEntry>();

export function __resetCsrLedgerStore(): void {
  entries.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('csr-ledger', ConfigSchema);
}

function periodKey(period: 'monthly' | 'quarterly', d = new Date()): string {
  const y = d.getUTCFullYear();
  if (period === 'quarterly') {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `\( {y}-Q \){q}`;
  }
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `\( {y}- \){m}`;
}

export async function logHours(
  tenantId: string,
  actorId: string,
  input: {
    csrPartnerId: string;
    employeeActorId: string;
    hoursLogged: number;
    shiftId?: string;
    contractId?: string;
    verified?: boolean;
  },
): Promise<CsrHourEntry> {
  return runCrudOperation({
    configName: 'csr-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!(input.hoursLogged > 0)) {
        throw new AppError('hoursLogged must be positive', ErrorCode.BAD_REQUEST);
      }
      const partner = await getPartner(tenantId, input.csrPartnerId);
      if (!partner) throw new AppError('CSR partner not found', ErrorCode.NOT_FOUND);
      if (config.requireShiftId && !input.shiftId) {
        throw new AppError('shiftId is required', ErrorCode.BAD_REQUEST);
      }

      const entry: CsrHourEntry = {
        id: crypto.randomUUID(),
        tenantId,
        csrPartnerId: input.csrPartnerId,
        employeeActorId: input.employeeActorId,
        hoursLogged: input.hoursLogged,
        shiftId: input.shiftId || null,
        contractId: input.contractId || null,
        verified: input.verified ?? false,
        periodKey: periodKey(partner.period),
        createdAt: new Date().toISOString(),
      };
      entries.set(entry.id, entry);
      logger.info(
        { entryId: entry.id, hours: entry.hoursLogged, partnerId: partner.id },
        'CSR hours logged',
      );
      return entry;
    },
    auditAction: 'data.created',
    auditResource: 'csr_hour_ledger',
    meterEventType: 'api_call',
  });
}

export async function getPartnerHourSummary(
  tenantId: string,
  csrPartnerId: string,
  period?: string,
): Promise<{
  partnerId: string;
  periodKey: string;
  pledged: number;
  logged: number;
  verified: number;
  remaining: number;
  entries: CsrHourEntry[];
}> {
  const partner = await getPartner(tenantId, csrPartnerId);
  if (!partner) throw new AppError('CSR partner not found', ErrorCode.NOT_FOUND);

  const key = period || periodKey(partner.period);
  const list = [...entries.values()].filter(
    (e) =>
      e.tenantId === tenantId &&
      e.csrPartnerId === csrPartnerId &&
      e.periodKey === key,
  );
  const logged = list.reduce((s, e) => s + e.hoursLogged, 0);
  const verified = list
    .filter((e) => e.verified)
    .reduce((s, e) => s + e.hoursLogged, 0);

  return {
    partnerId: csrPartnerId,
    periodKey: key,
    pledged: partner.pledgedHoursPerPeriod,
    logged: Math.round(logged * 100) / 100,
    verified: Math.round(verified * 100) / 100,
    remaining: Math.round((partner.pledgedHoursPerPeriod - logged) * 100) / 100,
    entries: list,
  };
}

/**
 * C4-style partner report: hour summary + optional evidence refs.
 */
export async function generatePartnerReport(
  tenantId: string,
  actorId: string,
  csrPartnerId: string,
  period?: string,
): Promise<{
  partnerId: string;
  periodKey: string;
  summary: Awaited<ReturnType<typeof getPartnerHourSummary>>;
  contractIds: string[];
  generatedAt: string;
  reportHash: string;
}> {
  return runCrudOperation({
    configName: 'csr-ledger',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const summary = await getPartnerHourSummary(tenantId, csrPartnerId, period);
      const contractIds = [
        ...new Set(
          summary.entries
            .map((e) => e.contractId)
            .filter((id): id is string => !!id),
        ),
      ];
      const generatedAt = new Date().toISOString();
      const reportHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            partnerId: csrPartnerId,
            periodKey: summary.periodKey,
            logged: summary.logged,
            verified: summary.verified,
            contractIds,
            generatedAt,
          }),
        )
        .digest('hex');

      return {
        partnerId: csrPartnerId,
        periodKey: summary.periodKey,
        summary,
        contractIds,
        generatedAt,
        reportHash,
      };
    },
    auditAction: 'data.read',
    auditResource: 'csr_report',
    meterEventType: 'api_call',
  });
}

export async function listLedgerEntries(
  tenantId: string,
  csrPartnerId: string,
): Promise<CsrHourEntry[]> {
  return [...entries.values()].filter(
    (e) => e.tenantId === tenantId && e.csrPartnerId === csrPartnerId,
  );
}
