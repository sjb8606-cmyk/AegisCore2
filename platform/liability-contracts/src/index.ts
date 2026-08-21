/**
 * platform/liability-contracts
 *
 * Niche-agnostic binding agreements: draft → sign (consent + terms hash).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { captureConsent } from '@platform/consent-capture';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('liability-contracts');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  niche: z.string().default('generic'),
  termsTemplate: z
    .string()
    .default(
      'Agreement between {{partyA}} and {{partyB}} regarding {{entity}}. Effective {{start}} to {{end}}.',
    ),
  requiresConsentCapture: z.boolean().default(true),
});

export type LiabilityContractsConfig = z.infer<typeof ConfigSchema>;

export type ContractStatus =
  | 'draft'
  | 'signed'
  | 'active'
  | 'completed'
  | 'incident';

export interface LiabilityContract {
  id: string;
  tenantId: string;
  niche: string;
  partyAId: string;
  partyBId: string;
  entityId: string | null;
  status: ContractStatus;
  termsText: string;
  termsHash: string;
  signature: string | null;
  startTime: string | null;
  endTime: string | null;
  consentEventId: string | null;
  chainHash: string;
  previousHash: string;
  createdAt: string;
  signedAt: string | null;
}

const contracts = new Map<string, LiabilityContract>();
const chainTips = new Map<string, string>();

export function __resetLiabilityContractsStore(): void {
  contracts.clear();
  chainTips.clear();
}

async function loadCfg(): Promise<LiabilityContractsConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('liability-contracts', ConfigSchema);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function renderTerms(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export async function createContract(
  tenantId: string,
  actorId: string,
  input: {
    niche?: string;
    partyAId: string;
    partyBId: string;
    entityId?: string;
    startTime?: string;
    endTime?: string;
    termsOverride?: string;
  },
): Promise<LiabilityContract> {
  return runCrudOperation({
    configName: 'liability-contracts',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.partyAId || !input.partyBId) {
        throw new AppError('partyAId and partyBId are required', ErrorCode.BAD_REQUEST);
      }

      const niche = input.niche || config.niche;
      const termsText =
        input.termsOverride ||
        renderTerms(config.termsTemplate, {
          partyA: input.partyAId,
          partyB: input.partyBId,
          entity: input.entityId || 'n/a',
          start: input.startTime || 'TBD',
          end: input.endTime || 'TBD',
        });

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const termsHash = sha256(termsText);
      const previousHash = chainTips.get(tenantId) || GENESIS_HASH;
      const chainHash = computeChainHash(
        tenantId,
        'liability_contract',
        { id, termsHash, status: 'draft', createdAt },
        previousHash,
      );
      chainTips.set(tenantId, chainHash);

      const contract: LiabilityContract = {
        id,
        tenantId,
        niche,
        partyAId: input.partyAId,
        partyBId: input.partyBId,
        entityId: input.entityId || null,
        status: 'draft',
        termsText,
        termsHash,
        signature: null,
        startTime: input.startTime || null,
        endTime: input.endTime || null,
        consentEventId: null,
        chainHash,
        previousHash,
        createdAt,
        signedAt: null,
      };
      contracts.set(id, contract);
      logger.info({ contractId: id, niche }, 'Contract draft created');
      return contract;
    },
    auditAction: 'data.created',
    auditResource: 'liability_contract',
    meterEventType: 'api_call',
  });
}

export async function signContract(
  tenantId: string,
  actorId: string,
  contractId: string,
  input: {
    geoData?: { lat: number; lng: number };
    deviceMeta?: Record<string, unknown>;
  } = {},
): Promise<LiabilityContract> {
  return runCrudOperation({
    configName: 'liability-contracts',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const contract = contracts.get(contractId);
      if (!contract || contract.tenantId !== tenantId) {
        throw new AppError('Contract not found', ErrorCode.NOT_FOUND);
      }
      if (contract.status !== 'draft') {
        throw new AppError(
          `Cannot sign contract in status '${contract.status}'`,
          ErrorCode.CONFLICT,
        );
      }

      let consentEventId: string | null = null;
      if (config.requiresConsentCapture) {
        const event = await captureConsent(tenantId, actorId, {
          contractId,
          consent: true,
          consentText: contract.termsText,
          geoData: input.geoData,
          deviceMeta: input.deviceMeta,
        });
        consentEventId = event.id;
      }

      const signedAt = new Date().toISOString();
      const signature = sha256(
        [contract.termsHash, actorId, signedAt, consentEventId || ''].join('|'),
      );

      const previousHash = chainTips.get(tenantId) || GENESIS_HASH;
      const chainHash = computeChainHash(
        tenantId,
        'liability_contract',
        { id: contractId, termsHash: contract.termsHash, status: 'signed', signedAt },
        previousHash,
      );
      chainTips.set(tenantId, chainHash);

      contract.status = 'signed';
      contract.signature = signature;
      contract.consentEventId = consentEventId;
      contract.signedAt = signedAt;
      contract.chainHash = chainHash;
      contract.previousHash = previousHash;
      contracts.set(contractId, contract);

      logger.info({ contractId, actorId }, 'Contract signed');
      return contract;
    },
    auditAction: 'data.updated',
    auditResource: 'liability_contract',
    meterEventType: 'api_call',
  });
}

export async function setContractStatus(
  tenantId: string,
  actorId: string,
  contractId: string,
  status: ContractStatus,
): Promise<LiabilityContract> {
  return runCrudOperation({
    configName: 'liability-contracts',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const contract = contracts.get(contractId);
      if (!contract || contract.tenantId !== tenantId) {
        throw new AppError('Contract not found', ErrorCode.NOT_FOUND);
      }
      contract.status = status;
      contracts.set(contractId, contract);
      return contract;
    },
    auditAction: 'data.updated',
    auditResource: 'liability_contract',
    meterEventType: 'api_call',
  });
}

export async function getContract(
  tenantId: string,
  contractId: string,
): Promise<LiabilityContract | null> {
  const c = contracts.get(contractId);
  if (!c || c.tenantId !== tenantId) return null;
  return c;
}

export async function listContracts(
  tenantId: string,
  filter?: { niche?: string; status?: ContractStatus },
): Promise<LiabilityContract[]> {
  return [...contracts.values()].filter(
    (c) =>
      c.tenantId === tenantId &&
      (!filter?.niche || c.niche === filter.niche) &&
      (!filter?.status || c.status === filter.status),
  );
}
