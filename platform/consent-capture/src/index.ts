/**
 * platform/consent-capture
 *
 * Signed, timestamped, optionally geo-stamped consent events.
 * consent_text_hash binds the exact terms shown at sign time.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { computeChainHash, GENESIS_HASH } from '@platform/hash-chain';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('consent-capture');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireGeoStamp: z.boolean().default(true),
  requireDeviceStamp: z.boolean().default(false),
});

export type ConsentCaptureConfig = z.infer<typeof ConfigSchema>;

export interface GeoData {
  lat: number;
  lng: number;
  accuracyM?: number;
}

export interface ConsentEvent {
  id: string;
  tenantId: string;
  actorId: string;
  contractId: string;
  consent: true;
  consentTextHash: string;
  geoLat: number | null;
  geoLng: number | null;
  deviceMeta: Record<string, unknown> | null;
  chainHash: string;
  previousHash: string;
  createdAt: string;
}

const events = new Map<string, ConsentEvent>();
const byContract = new Map<string, string[]>(); // contractId → event ids
const chainTips = new Map<string, string>();

export function __resetConsentCaptureStore(): void {
  events.clear();
  byContract.clear();
  chainTips.clear();
}

async function loadCfg(): Promise<ConsentCaptureConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('consent-capture', ConfigSchema);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function captureConsent(
  tenantId: string,
  actorId: string,
  input: {
    contractId: string;
    consent: boolean;
    consentText: string;
    geoData?: GeoData;
    deviceMeta?: Record<string, unknown>;
  },
): Promise<ConsentEvent> {
  return runCrudOperation({
    configName: 'consent-capture',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();

      if (input.consent !== true) {
        throw new AppError('consent must be true to capture', ErrorCode.BAD_REQUEST);
      }
      if (!input.contractId) {
        throw new AppError('contractId is required', ErrorCode.BAD_REQUEST);
      }
      if (!input.consentText?.trim()) {
        throw new AppError('consentText is required', ErrorCode.BAD_REQUEST);
      }

      if (config.requireGeoStamp) {
        if (
          input.geoData == null ||
          typeof input.geoData.lat !== 'number' ||
          typeof input.geoData.lng !== 'number'
        ) {
          throw new AppError('geoData is required', ErrorCode.BAD_REQUEST);
        }
      }
      if (config.requireDeviceStamp && !input.deviceMeta) {
        throw new AppError('deviceMeta is required', ErrorCode.BAD_REQUEST);
      }

      const consentTextHash = sha256(input.consentText.trim());
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const previousHash = chainTips.get(tenantId) || GENESIS_HASH;
      const chainPayload = {
        id,
        contractId: input.contractId,
        actorId,
        consentTextHash,
        createdAt,
      };
      const chainHash = computeChainHash(
        tenantId,
        'consent_event',
        chainPayload,
        previousHash,
      );
      chainTips.set(tenantId, chainHash);

      const event: ConsentEvent = {
        id,
        tenantId,
        actorId,
        contractId: input.contractId,
        consent: true,
        consentTextHash,
        geoLat: input.geoData?.lat ?? null,
        geoLng: input.geoData?.lng ?? null,
        deviceMeta: input.deviceMeta ?? null,
        chainHash,
        previousHash,
        createdAt,
      };
      events.set(id, event);
      const list = byContract.get(input.contractId) || [];
      list.push(id);
      byContract.set(input.contractId, list);

      logger.info({ eventId: id, contractId: input.contractId }, 'Consent captured');
      return event;
    },
    auditAction: 'data.created',
    auditResource: 'consent_event',
    meterEventType: 'api_call',
  });
}

export async function getConsentEventsForContract(
  tenantId: string,
  contractId: string,
): Promise<ConsentEvent[]> {
  const ids = byContract.get(contractId) || [];
  return ids
    .map((id) => events.get(id)!)
    .filter((e) => e && e.tenantId === tenantId);
}

export async function getConsentEvent(
  tenantId: string,
  eventId: string,
): Promise<ConsentEvent | null> {
  const e = events.get(eventId);
  if (!e || e.tenantId !== tenantId) return null;
  return e;
}
