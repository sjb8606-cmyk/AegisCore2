/**
 * platform/security/src/vault.ts
 *
 * HashiCorp Vault client for secret retrieval and rotation.
 *
 * Authentication: AppRole (preferred for machine-to-machine).
 * Fallback:       VAULT_TOKEN (dev only).
 *
 * Caching: secrets cached in-memory with TTL to reduce Vault round-trips.
 * Rotation: real rotation is not yet implemented — callers must handle
 *           NOT_IMPLEMENTED until the endpoint is wired.
 */

import { getLogger } from '@platform/observability';

const logger = getLogger('security:vault');

const VAULT_ADDR  = process.env.VAULT_ADDR        || 'http://localhost:8200';
const VAULT_NS    = process.env.VAULT_NAMESPACE    || '';
const MOUNT_PATH  = process.env.VAULT_MOUNT_PATH   || 'secret';

interface TokenCache {
  token:     string;
  expiresAt: number;
}

let _tokenCache: TokenCache | null = null;

interface CachedSecret {
  value:     Record<string, string>;
  expiresAt: number;
}

const secretCache = new Map<string, CachedSecret>();
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

async function getVaultToken(): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > Date.now()) {
    return _tokenCache.token;
  }

  const roleId   = process.env.VAULT_ROLE_ID;
  const secretId = process.env.VAULT_SECRET_ID;

  if (!roleId || !secretId) {
    const token = process.env.VAULT_TOKEN;
    if (!token) throw new Error('No Vault credentials configured');
    return token;
  }

  const resp = await fetch(`${VAULT_ADDR}/v1/auth/approle/login`, {
    method:  'POST',
    headers: buildHeaders(''),
    body:    JSON.stringify({ role_id: roleId, secret_id: secretId }),
  });

  if (!resp.ok) {
    throw new Error(`Vault AppRole login failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as {
    auth: { client_token: string; lease_duration: number };
  };

  _tokenCache = {
    token:     data.auth.client_token,
    expiresAt: Date.now() + data.auth.lease_duration * 1000,
  };

  return _tokenCache.token;
}

export async function getSecret(path: string): Promise<Record<string, string>> {
  const cached = secretCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const token = await getVaultToken();
  const url   = `\( {VAULT_ADDR}/v1/ \){MOUNT_PATH}/data/${path}`;

  const resp = await fetch(url, {
    method:  'GET',
    headers: buildHeaders(token),
  });

  if (!resp.ok) {
    throw new Error(`Vault getSecret failed for '${path}': ${resp.status} ${await resp.text()}`);
  }

  const body = await resp.json() as { data: { data: Record<string, string> } };
  const value = body.data.data;

  secretCache.set(path, {
    value,
    expiresAt: Date.now() + SECRET_CACHE_TTL_MS,
  });

  return value;
}

export async function getSecretField(path: string, field: string): Promise<string> {
  const data = await getSecret(path);
  if (!(field in data)) {
    throw new Error(`Field '\( {field}' not found in secret ' \){path}'`);
  }
  return data[field];
}

export interface RotationResult {
  path:      string;
  rotatedAt: string;
  success:   boolean;
  error?:    string;
}

export async function rotateSecret(path: string): Promise<RotationResult> {
  logger.warn({ path }, 'Secret rotation requested — not implemented');
  secretCache.delete(path);
  throw new Error(
    `NOT_IMPLEMENTED: rotateSecret('${path}') — Vault rotation endpoint is not wired yet. ` +
    `Do not treat this as a successful rotation.`
  );
}

export async function testRotation(path: string): Promise<boolean> {
  try {
    await rotateSecret(path);
    return true;
  } catch {
    return false;
  }
}

function buildHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token)    headers['X-Vault-Token']     = token;
  if (VAULT_NS) headers['X-Vault-Namespace'] = VAULT_NS;
  return headers;
}

export function invalidateSecretCache(): void {
  secretCache.clear();
  _tokenCache = null;
}
