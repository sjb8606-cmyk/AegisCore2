import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxSitesPerContract: z.number().int().positive().default(1000)
});

export const SiteSchema = z.object({
  siteId: z.string().uuid(),
  address: z.string().min(1).max(2000),
  accessRequirements: z.record(z.unknown()).default({}),
  siteChecklistOverride: z.record(z.unknown()).nullable().default(null)
});

export type Site = z.infer<typeof SiteSchema>;

export const CommercialMultisiteContractSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  contractId: z.string().uuid(),
  clientId: z.string().uuid(),
  sites: z.array(SiteSchema)
});

export type CommercialMultisiteContract = z.infer<
  typeof CommercialMultisiteContractSchema
>;

const contractStore = new Map<
  string,
  CommercialMultisiteContract
>();

const invoiceStore = new Map<
  string,
  {
    tenantId: string;
    contractId: string;
    billingPeriod: string;
    invoice: Record<string, unknown>;
  }
>();

export function __resetCommercialMultisiteContractStore(): void {
  contractStore.clear();
  invoiceStore.clear();
}

function getContract(
  tenantId: string,
  contractId: string
): CommercialMultisiteContract {
  const contract = contractStore.get(contractId);

  if (!contract) {
    throw new AppError(
      'Commercial multisite contract not found',
      ErrorCode.NOT_FOUND
    );
  }

  if (contract.tenantId !== tenantId) {
    throw new AppError(
      'Resource does not belong to tenant',
      ErrorCode.FORBIDDEN
    );
  }

  return contract;
}

export async function createContract(
  tenantId: string,
  actorId: string,
  input: Omit<
    CommercialMultisiteContract,
    'id' | 'tenantId'
  >
): Promise<CommercialMultisiteContract> {
  return runCrudOperation({
    configName: 'commercial-multisite-contract',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const existing = contractStore.get(input.contractId);

      if (existing && existing.tenantId === tenantId) {
        throw new AppError(
          'Contract already exists',
          ErrorCode.CONFLICT
        );
      }

      const contract =
        CommercialMultisiteContractSchema.parse({
          id: crypto.randomUUID(),
          tenantId,
          ...input
        });

      const config = ConfigSchema.parse({
        enabled: true,
        maxSitesPerContract: 1000
      });

      if (contract.sites.length > config.maxSitesPerContract) {
        throw new AppError(
          'Maximum site count exceeded',
          ErrorCode.RATE_LIMITED
        );
      }

      contractStore.set(
        contract.contractId,
        contract
      );

      return contract;
    },
    auditAction: 'data.created',
    auditResource: 'commercial_multisite_contract',
    meterEventType: 'api_call'
  });
}

export async function addSite(
  tenantId: string,
  actorId: string,
  contractId: string,
  siteData: Omit<Site, 'siteId'> & {
    siteId?: string;
  }
): Promise<Site> {
  return runCrudOperation({
    configName: 'commercial-multisite-contract',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const contract = getContract(
        tenantId,
        contractId
      );

      const config = ConfigSchema.parse({
        enabled: true,
        maxSitesPerContract: 1000
      });

      if (
        contract.sites.length >=
        config.maxSitesPerContract
      ) {
        throw new AppError(
          'Maximum site count exceeded',
          ErrorCode.RATE_LIMITED
        );
      }

      const site = SiteSchema.parse({
        siteId: siteData.siteId ?? crypto.randomUUID(),
        address: siteData.address,
        accessRequirements:
          siteData.accessRequirements ?? {},
        siteChecklistOverride:
          siteData.siteChecklistOverride ?? null
      });

      if (
        contract.sites.some(
          existing => existing.siteId === site.siteId
        )
      ) {
        throw new AppError(
          'Site already exists on contract',
          ErrorCode.CONFLICT
        );
      }

      contract.sites.push(site);

      contractStore.set(
        contract.contractId,
        contract
      );

      return site;
    },
    auditAction: 'data.updated',
    auditResource: 'commercial_multisite_contract',
    meterEventType: 'api_call'
  });
}

export async function getConsolidatedInvoice(
  tenantId: string,
  actorId: string,
  contractId: string,
  billingPeriod: string
): Promise<Record<string, unknown>> {
  return runCrudOperation({
    configName: 'commercial-multisite-contract',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const contract = getContract(
        tenantId,
        contractId
      );

      if (!billingPeriod.trim()) {
        throw new AppError(
          'Billing period is required',
          ErrorCode.BAD_REQUEST
        );
      }

      const key =
        tenantId +
        ':' +
        contractId +
        ':' +
        billingPeriod;

      const existing = invoiceStore.get(key);

      if (existing) {
        return existing.invoice;
      }

      const invoice = {
        contractId: contract.contractId,
        clientId: contract.clientId,
        billingPeriod,
        siteCount: contract.sites.length,
        consolidated: true,
        status: 'draft'
      };

      invoiceStore.set(key, {
        tenantId,
        contractId,
        billingPeriod,
        invoice
      });

      return invoice;
    },
    auditAction: 'data.read',
    auditResource: 'commercial_multisite_invoice',
    meterEventType: 'api_call'
  });
}

export async function getSiteChecklist(
  tenantId: string,
  actorId: string,
  siteId: string,
  contractDefault: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return runCrudOperation({
    configName: 'commercial-multisite-contract',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const contract = Array.from(
        contractStore.values()
      ).find(
        item =>
          item.tenantId === tenantId &&
          item.sites.some(
            site => site.siteId === siteId
          )
      );

      if (!contract) {
        throw new AppError(
          'Site not found',
          ErrorCode.NOT_FOUND
        );
      }

      const site = contract.sites.find(
        item => item.siteId === siteId
      );

      if (!site) {
        throw new AppError(
          'Site not found',
          ErrorCode.NOT_FOUND
        );
      }

      return (
        site.siteChecklistOverride ??
        contractDefault
      );
    },
    auditAction: 'data.read',
    auditResource: 'commercial_multisite_contract',
    meterEventType: 'api_call'
  });
}
