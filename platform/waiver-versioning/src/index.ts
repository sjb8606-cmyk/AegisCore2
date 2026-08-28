/**
 * platform/waiver-versioning (FIT-05)
 *
 * Published waiver versions + member signatures.
 * assertWaiverCurrent blocks check-in when unsigned/stale.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('waiver-versioning');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  blockWhenStale: z.boolean().default(true),
  waiverType: z.string().default('general_liability'),
});

export interface WaiverVersion {
  id: string;
  tenantId: string;
  version: string;
  title: string;
  bodyHash: string;
  effectiveAt: string;
  active: boolean;
  createdAt: string;
}

export interface WaiverSignature {
  id: string;
  tenantId: string;
  memberId: string;
  waiverVersionId: string;
  version: string;
  signedAt: string;
  signatureRef: string;
  actorId: string;
}

const versions = new Map<string, WaiverVersion>();
const signatures = new Map<string, WaiverSignature>();

export function __resetWaiverVersioningStore(): void {
  versions.clear();
  signatures.clear();
}

function sigKey(tenantId: string, memberId: string, versionId: string): string {
  return tenantId + ':' + memberId + ':' + versionId;
}

export async function publishWaiverVersion(
  tenantId: string,
  actorId: string,
  input: {
    version: string;
    title: string;
    bodyHash: string;
    effectiveAt?: string;
    makeActive?: boolean;
  },
): Promise<WaiverVersion> {
  return runCrudOperation({
    configName: 'waiver-versioning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.version?.trim() || !input.title?.trim() || !input.bodyHash?.trim()) {
        throw new AppError(
          'version, title, bodyHash required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const dup = [...versions.values()].find(
        (v) =>
          v.tenantId === tenantId &&
          v.version === input.version.trim(),
      );
      if (dup) {
        throw new AppError('Version already exists', ErrorCode.CONFLICT);
      }
      const effective = input.effectiveAt
        ? Date.parse(input.effectiveAt)
        : Date.now();
      if (Number.isNaN(effective)) {
        throw new AppError('invalid effectiveAt', ErrorCode.BAD_REQUEST);
      }
      if (input.makeActive !== false) {
        for (const [id, v] of versions) {
          if (v.tenantId === tenantId && v.active) {
            v.active = false;
            versions.set(id, v);
          }
        }
      }
      const row: WaiverVersion = {
        id: crypto.randomUUID(),
        tenantId,
        version: input.version.trim(),
        title: input.title.trim(),
        bodyHash: input.bodyHash.trim(),
        effectiveAt: new Date(effective).toISOString(),
        active: input.makeActive !== false,
        createdAt: new Date().toISOString(),
      };
      versions.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'fit_waiver_version',
    meterEventType: 'api_call',
  });
}

export async function signWaiver(
  tenantId: string,
  actorId: string,
  input: {
    memberId: string;
    waiverVersionId: string;
    signatureRef: string;
  },
): Promise<WaiverSignature> {
  return runCrudOperation({
    configName: 'waiver-versioning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.memberId?.trim() || !input.signatureRef?.trim()) {
        throw new AppError(
          'memberId and signatureRef required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const ver = versions.get(input.waiverVersionId);
      if (!ver || ver.tenantId !== tenantId) {
        throw new AppError('Waiver version not found', ErrorCode.NOT_FOUND);
      }
      const key = sigKey(tenantId, input.memberId, ver.id);
      if (signatures.has(key)) {
        throw new AppError('Already signed this version', ErrorCode.CONFLICT);
      }
      const sig: WaiverSignature = {
        id: crypto.randomUUID(),
        tenantId,
        memberId: input.memberId,
        waiverVersionId: ver.id,
        version: ver.version,
        signedAt: new Date().toISOString(),
        signatureRef: input.signatureRef.trim(),
        actorId,
      };
      signatures.set(key, sig);
      logger.info(
        { memberId: input.memberId, version: ver.version },
        'Waiver signed',
      );
      return sig;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'fit_waiver_signature',
    meterEventType: 'api_call',
  });
}

export async function getActiveWaiverVersion(
  tenantId: string,
): Promise<WaiverVersion | null> {
  const active = [...versions.values()].filter(
    (v) => v.tenantId === tenantId && v.active,
  );
  if (active.length === 0) return null;
  return active.sort(
    (a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt),
  )[0];
}

export async function assertWaiverCurrent(
  tenantId: string,
  memberId: string,
): Promise<{ current: boolean; activeVersion: string | null; signedVersion: string | null }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('waiver-versioning', ConfigSchema);
  const active = await getActiveWaiverVersion(tenantId);
  if (!active) {
    if (config.blockWhenStale) {
      throw new AppError('No active waiver version published', ErrorCode.FORBIDDEN);
    }
    return { current: true, activeVersion: null, signedVersion: null };
  }
  const key = sigKey(tenantId, memberId, active.id);
  const sig = signatures.get(key);
  if (!sig) {
    if (config.blockWhenStale) {
      throw new AppError(
        'Member must sign waiver version ' + active.version,
        ErrorCode.FORBIDDEN,
      );
    }
    return {
      current: false,
      activeVersion: active.version,
      signedVersion: null,
    };
  }
  return {
    current: true,
    activeVersion: active.version,
    signedVersion: sig.version,
  };
}

export async function getMemberWaiverStatus(
  tenantId: string,
  actorId: string,
  memberId: string,
): Promise<{
  activeVersion: WaiverVersion | null;
  signature: WaiverSignature | null;
  current: boolean;
}> {
  return runCrudOperation({
    configName: 'waiver-versioning',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const active = await getActiveWaiverVersion(tenantId);
      if (!active) {
        return { activeVersion: null, signature: null, current: true };
      }
      const sig =
        signatures.get(sigKey(tenantId, memberId, active.id)) || null;
      return {
        activeVersion: active,
        signature: sig,
        current: !!sig,
      };
    },
    auditAction: 'data.read',
    auditResource: 'fit_waiver_signature',
    meterEventType: 'api_call',
  });
}
