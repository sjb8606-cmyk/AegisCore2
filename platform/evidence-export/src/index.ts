/**
 * platform/evidence-export
 *
 * Packages contract + consent + incidents + WORM audit into one bundle.
 * JSON is first-class; PDF is a structured placeholder until a renderer is wired.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { getConsentEventsForContract } from '@platform/consent-capture';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { listIncidents } from '@platform/incident-breaker';
import { getContract } from '@platform/liability-contracts';
import { queryAuditLog } from '@platform/worm-audit';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('evidence-export');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  formats: z.array(z.enum(['pdf', 'json'])).default(['json', 'pdf']),
  includeAuditTrail: z.boolean().default(true),
});

export type EvidenceExportConfig = z.infer<typeof ConfigSchema>;

export interface EvidenceBundle {
  id: string;
  tenantId: string;
  contractId: string;
  format: 'json' | 'pdf';
  generatedAt: string;
  bundleHash: string;
  contract: unknown;
  consentEvents: unknown[];
  incidents: unknown[];
  auditTrail: unknown[];
  /** For json: full payload; for pdf: mock url until renderer exists */
  payload: unknown;
  downloadUrl: string | null;
}

const exports_ = new Map<string, EvidenceBundle>();

export function __resetEvidenceExportStore(): void {
  exports_.clear();
}

async function loadCfg(): Promise<EvidenceExportConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('evidence-export', ConfigSchema);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') +
    '}'
  );
}

export async function exportContractEvidence(
  tenantId: string,
  actorId: string,
  contractId: string,
  format: 'json' | 'pdf' = 'json',
): Promise<EvidenceBundle> {
  return runCrudOperation({
    configName: 'evidence-export',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!config.formats.includes(format)) {
        throw new AppError(`Format not allowed: ${format}`, ErrorCode.BAD_REQUEST);
      }

      const contract = await getContract(tenantId, contractId);
      if (!contract) {
        throw new AppError('Contract not found', ErrorCode.NOT_FOUND);
      }

      const consentEvents = await getConsentEventsForContract(tenantId, contractId);
      const incidents = await listIncidents(tenantId, { contractId });
      const auditTrail = config.includeAuditTrail
        ? await queryAuditLog(tenantId, {
            entityId: contractId,
            entityType: 'liability_contract',
          })
        : [];

      const body = {
        contract,
        consentEvents,
        incidents,
        auditTrail,
      };
      const bundleHash = crypto
        .createHash('sha256')
        .update(stableStringify(body), 'utf8')
        .digest('hex');

      const id = crypto.randomUUID();
      const generatedAt = new Date().toISOString();
      const bundle: EvidenceBundle = {
        id,
        tenantId,
        contractId,
        format,
        generatedAt,
        bundleHash,
        contract,
        consentEvents,
        incidents,
        auditTrail,
        payload:
          format === 'json'
            ? { ...body, bundleHash, generatedAt }
            : {
                note: 'PDF renderer not wired — use json format or attach renderer',
                bundleHash,
                summary: {
                  contractId,
                  status: (contract as any).status,
                  consentCount: consentEvents.length,
                  incidentCount: incidents.length,
                  auditCount: auditTrail.length,
                },
              },
        downloadUrl:
          format === 'pdf'
            ? `https://cdn.mock/evidence/${id}.pdf`
            : null,
      };
      exports_.set(id, bundle);
      logger.info({ exportId: id, contractId, format }, 'Evidence bundle generated');
      return bundle;
    },
    auditAction: 'data.read',
    auditResource: 'evidence_export',
    meterEventType: 'api_call',
  });
}

export async function getEvidenceBundle(
  tenantId: string,
  exportId: string,
): Promise<EvidenceBundle | null> {
  const b = exports_.get(exportId);
  if (!b || b.tenantId !== tenantId) return null;
  return b;
}
