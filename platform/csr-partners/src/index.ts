/**
 * platform/csr-partners
 *
 * Company CSR partner profiles + pledged volunteer-hour pool.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('csr-partners');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultPeriod: z.enum(['monthly', 'quarterly']).default('monthly'),
});

export type CsrPartnersConfig = z.infer<typeof ConfigSchema>;
export type CsrPeriod = 'monthly' | 'quarterly';

export interface CsrPartner {
  id: string;
  tenantId: string;
  companyName: string;
  contactEmail: string;
  pledgedHoursPerPeriod: number;
  period: CsrPeriod;
  active: boolean;
  createdAt: string;
}

const partners = new Map<string, CsrPartner>();

export function __resetCsrPartnersStore(): void {
  partners.clear();
}

async function loadCfg(): Promise<CsrPartnersConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('csr-partners', ConfigSchema);
}

export async function createPartner(
  tenantId: string,
  actorId: string,
  input: {
    companyName: string;
    contactEmail: string;
    pledgedHoursPerPeriod: number;
    period?: CsrPeriod;
  },
): Promise<CsrPartner> {
  return runCrudOperation({
    configName: 'csr-partners',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.companyName?.trim()) {
        throw new AppError('companyName is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.contactEmail?.includes('@')) {
        throw new AppError('valid contactEmail required', ErrorCode.BAD_REQUEST);
      }
      if (!(input.pledgedHoursPerPeriod > 0)) {
        throw new AppError('pledgedHoursPerPeriod must be positive', ErrorCode.BAD_REQUEST);
      }
      const partner: CsrPartner = {
        id: crypto.randomUUID(),
        tenantId,
        companyName: input.companyName.trim(),
        contactEmail: input.contactEmail.trim().toLowerCase(),
        pledgedHoursPerPeriod: input.pledgedHoursPerPeriod,
        period: input.period || config.defaultPeriod,
        active: true,
        createdAt: new Date().toISOString(),
      };
      partners.set(partner.id, partner);
      logger.info({ partnerId: partner.id }, 'CSR partner created');
      return partner;
    },
    auditAction: 'data.created',
    auditResource: 'csr_partner',
    meterEventType: 'api_call',
  });
}

export async function getPartner(
  tenantId: string,
  partnerId: string,
): Promise<CsrPartner | null> {
  const p = partners.get(partnerId);
  if (!p || p.tenantId !== tenantId) return null;
  return p;
}

export async function listPartners(
  tenantId: string,
  activeOnly = true,
): Promise<CsrPartner[]> {
  return [...partners.values()].filter(
    (p) => p.tenantId === tenantId && (!activeOnly || p.active),
  );
}
