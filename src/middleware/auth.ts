/**
 * Veridact v1.0 — Auth Middleware
 *
 * NOTE: the dev fallback key is checked dynamically, per-request, rather
 * than baked into the static API_KEYS map at import time — fixes a real
 * bug where setting VERIDACT_DEV_API_KEY after the module loads (e.g. in
 * a test's beforeEach, or local dev after a hot-reload) would silently
 * never take effect.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

interface ApiKeyEntry {
  key_id: string;
  tenant_id: string;
  description: string;
}

function loadStaticApiKeys(): Map<string, ApiKeyEntry> {
  const raw = process.env.VERIDACT_API_KEYS ?? '';
  const map = new Map<string, ApiKeyEntry>();

  if (raw) {
    for (const entry of raw.split(',')) {
      const [keyId, tenantId, rawKey] = entry.trim().split(':');
      if (keyId && tenantId && rawKey) {
        map.set(rawKey, { key_id: keyId, tenant_id: tenantId, description: keyId });
      }
    }
  }

  return map;
}

const API_KEYS = loadStaticApiKeys();

function resolveDevKey(rawKey: string): ApiKeyEntry | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (!process.env.VERIDACT_DEV_API_KEY) return null;
  if (rawKey !== process.env.VERIDACT_DEV_API_KEY) return null;

  return {
    key_id: 'dev-key',
    tenant_id: process.env.VERIDACT_DEV_TENANT_ID ?? '00000000-0000-0000-0000-000000000001',
    description: 'Development key — dev only',
  };
}

const TenantIdSchema = z.string().uuid();

export interface AuthenticatedRequest extends Request {
  actor: {
    type: 'api_key';
    id: string;
    metadata: { ip?: string; user_agent?: string };
  };
  tenantId: string;
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <api_key>',
    });
    return;
  }

  const rawKey = authHeader.slice(7).trim();
  const entry = API_KEYS.get(rawKey) ?? resolveDevKey(rawKey);

  if (!entry) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
    return;
  }

  const tenantHeader = req.headers['x-tenant-id'] as string | undefined;
  const tenantId = tenantHeader ?? entry.tenant_id;

  const tenantParsed = TenantIdSchema.safeParse(tenantId);
  if (!tenantParsed.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'X-Tenant-ID must be a valid UUID',
    });
    return;
  }

  (req as AuthenticatedRequest).actor = {
    type: 'api_key',
    id: entry.key_id,
    metadata: {
      ip: (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress,
      user_agent: req.headers['user-agent'],
    },
  };

  (req as AuthenticatedRequest).tenantId = tenantParsed.data;

  next();
}
