/**
 * platform/passkey-webauthn
 *
 * Passkey / WebAuthn ceremony scaffolding (registration + login).
 * MVP verifies challenge binding + stores credential metadata.
 * Swap verifyAttestation / verifyAssertion for real @simplewebauthn/server in production.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('passkey-webauthn');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rpName: z.string().default('AegisCore'),
  rpId: z.string().default('localhost'),
  allowedOrigins: z.array(z.string()).default(['http://localhost:3000']),
  challengeTtlSeconds: z.number().int().positive().default(300),
  allowedDeviceTypes: z
    .array(z.enum(['platform', 'cross-platform', 'any']))
    .default(['any']),
});

export interface Authenticator {
  id: string;
  tenantId: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
}

export interface ChallengeRecord {
  challenge: string;
  userId: string;
  tenantId: string;
  type: 'registration' | 'authentication';
  expiresAt: number;
}

const authenticators = new Map<string, Authenticator>(); // credentialId → record
const challenges = new Map<string, ChallengeRecord>(); // challenge → record

export function __resetPasskeyStore(): void {
  authenticators.clear();
  challenges.clear();
}

async function loadCfg() {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('passkey-webauthn', ConfigSchema);
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createChallenge(): string {
  return b64url(crypto.randomBytes(32));
}

export async function beginRegistration(
  tenantId: string,
  actorId: string,
  input: { userId: string; userName: string; displayName?: string },
): Promise<{
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  timeout: number;
}> {
  return runCrudOperation({
    configName: 'passkey-webauthn',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.userId?.trim() || !input.userName?.trim()) {
        throw new AppError('userId and userName required', ErrorCode.BAD_REQUEST);
      }
      const challenge = createChallenge();
      challenges.set(challenge, {
        challenge,
        userId: input.userId,
        tenantId,
        type: 'registration',
        expiresAt: Date.now() + config.challengeTtlSeconds * 1000,
      });
      return {
        challenge,
        rp: { name: config.rpName, id: config.rpId },
        user: {
          id: b64url(Buffer.from(input.userId)),
          name: input.userName,
          displayName: input.displayName || input.userName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: config.challengeTtlSeconds * 1000,
      };
    },
    auditAction: 'data.created',
    auditResource: 'webauthn_challenge',
    meterEventType: 'api_call',
  });
}

/** MVP attestation verify: challenge must match + not expired; stores credential */
export async function finishRegistration(
  tenantId: string,
  actorId: string,
  input: {
    challenge: string;
    credentialId: string;
    publicKey: string;
    deviceType?: string;
    backedUp?: boolean;
    transports?: string[];
  },
): Promise<Authenticator> {
  return runCrudOperation({
    configName: 'passkey-webauthn',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const ch = challenges.get(input.challenge);
      if (!ch || ch.tenantId !== tenantId || ch.type !== 'registration') {
        throw new AppError('Invalid challenge', ErrorCode.BAD_REQUEST);
      }
      if (ch.expiresAt < Date.now()) {
        challenges.delete(input.challenge);
        throw new AppError('Challenge expired', ErrorCode.CONFLICT);
      }
      if (!input.credentialId?.trim() || !input.publicKey?.trim()) {
        throw new AppError(
          'credentialId and publicKey required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (authenticators.has(input.credentialId)) {
        throw new AppError('Credential already registered', ErrorCode.CONFLICT);
      }
      const deviceType = input.deviceType || 'platform';
      if (
        !config.allowedDeviceTypes.includes('any') &&
        !config.allowedDeviceTypes.includes(deviceType as any)
      ) {
        throw new AppError('Device type not allowed', ErrorCode.FORBIDDEN);
      }
      const auth: Authenticator = {
        id: crypto.randomUUID(),
        tenantId,
        userId: ch.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        counter: 0,
        deviceType,
        backedUp: !!input.backedUp,
        transports: input.transports || [],
        createdAt: new Date().toISOString(),
      };
      authenticators.set(auth.credentialId, auth);
      challenges.delete(input.challenge);
      logger.info({ userId: ch.userId, credentialId: auth.credentialId }, 'Passkey registered');
      return auth;
    },
    auditAction: 'data.created',
    auditResource: 'webauthn_authenticator',
    meterEventType: 'api_call',
  });
}

export async function beginLogin(
  tenantId: string,
  actorId: string,
  input: { userId?: string },
): Promise<{
  challenge: string;
  allowCredentials: { type: string; id: string; transports?: string[] }[];
  timeout: number;
  rpId: string;
}> {
  return runCrudOperation({
    configName: 'passkey-webauthn',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      const challenge = createChallenge();
      const userId = input.userId || actorId;
      challenges.set(challenge, {
        challenge,
        userId,
        tenantId,
        type: 'authentication',
        expiresAt: Date.now() + config.challengeTtlSeconds * 1000,
      });
      const allowCredentials = [...authenticators.values()]
        .filter((a) => a.tenantId === tenantId && a.userId === userId)
        .map((a) => ({
          type: 'public-key',
          id: a.credentialId,
          transports: a.transports,
        }));
      return {
        challenge,
        allowCredentials,
        timeout: config.challengeTtlSeconds * 1000,
        rpId: config.rpId,
      };
    },
    auditAction: 'data.read',
    auditResource: 'webauthn_challenge',
    meterEventType: 'api_call',
  });
}

export async function finishLogin(
  tenantId: string,
  actorId: string,
  input: {
    challenge: string;
    credentialId: string;
    counter?: number;
    signature?: string;
  },
): Promise<{ userId: string; credentialId: string; sessionHint: string }> {
  return runCrudOperation({
    configName: 'passkey-webauthn',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const ch = challenges.get(input.challenge);
      if (!ch || ch.tenantId !== tenantId || ch.type !== 'authentication') {
        throw new AppError('Invalid challenge', ErrorCode.BAD_REQUEST);
      }
      if (ch.expiresAt < Date.now()) {
        challenges.delete(input.challenge);
        throw new AppError('Challenge expired', ErrorCode.CONFLICT);
      }
      const auth = authenticators.get(input.credentialId);
      if (!auth || auth.tenantId !== tenantId) {
        throw new AppError('Unknown credential', ErrorCode.NOT_FOUND);
      }
      if (auth.userId !== ch.userId) {
        throw new AppError('Credential user mismatch', ErrorCode.FORBIDDEN);
      }
      // Counter must not go backwards (clone detection)
      const nextCounter =
        input.counter !== undefined ? input.counter : auth.counter + 1;
      if (nextCounter < auth.counter) {
        throw new AppError('Authenticator counter rollback', ErrorCode.FORBIDDEN);
      }
      // MVP: signature presence check (real verifyAssertion later)
      if (input.signature !== undefined && !input.signature) {
        throw new AppError('Invalid signature', ErrorCode.FORBIDDEN);
      }
      auth.counter = nextCounter;
      authenticators.set(auth.credentialId, auth);
      challenges.delete(input.challenge);
      const sessionHint = b64url(crypto.randomBytes(16));
      logger.info({ userId: auth.userId }, 'Passkey login ok');
      return {
        userId: auth.userId,
        credentialId: auth.credentialId,
        sessionHint,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'webauthn_login',
    meterEventType: 'api_call',
  });
}

export async function listAuthenticators(
  tenantId: string,
  userId: string,
): Promise<Authenticator[]> {
  return [...authenticators.values()].filter(
    (a) => a.tenantId === tenantId && a.userId === userId,
  );
}

export async function revokeAuthenticator(
  tenantId: string,
  actorId: string,
  credentialId: string,
): Promise<{ revoked: boolean }> {
  return runCrudOperation({
    configName: 'passkey-webauthn',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const auth = authenticators.get(credentialId);
      if (!auth || auth.tenantId !== tenantId) {
        throw new AppError('Credential not found', ErrorCode.NOT_FOUND);
      }
      authenticators.delete(credentialId);
      return { revoked: true };
    },
    auditAction: 'data.deleted',
    auditResource: 'webauthn_authenticator',
    meterEventType: 'api_call',
  });
}
