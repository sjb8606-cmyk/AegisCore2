/**
 * @platform/api-docs
 *
 * Register API endpoints and generate OpenAPI 3.0 snapshots.
 * Pure domain core. Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const RegisterEndpointSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().min(1).max(500).regex(/^\//),
  summary: z.string().max(255).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  request_schema: z.record(z.unknown()).optional().nullable(),
  response_schema: z.record(z.unknown()).optional().nullable(),
  auth_required: z.boolean().default(true),
});

export const GenerateOpenApiSchema = z.object({
  title: z.string().min(1).max(255).default('API'),
  version: z.string().min(1).max(40).default('1.0.0'),
  publish: z.boolean().default(false),
});

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'api-docs');
  if (!cfg.enabled) {
    throw new AppError('API docs is disabled', ErrorCode.FORBIDDEN);
  }
  return cfg;
}

async function requireTier(tenantId: string, feature: string) {
  const cfg = await requireEnabled(tenantId);
  if (!cfg.tiers?.[feature]) {
    throw new AppError(`Feature ${feature} not available in current tier`, ErrorCode.FORBIDDEN);
  }
  return cfg;
}

export async function registerEndpoint(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'registerEndpoints');
  const parsed = RegisterEndpointSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM api_endpoints WHERE tenant_id = $1 AND active = true`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.maxEndpointsPerTenant ?? 500;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Endpoint limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO api_endpoints (
       tenant_id, method, path, summary, description, tags,
       request_schema, response_schema, auth_required, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
     ON CONFLICT (tenant_id, method, path) DO UPDATE SET
       summary = EXCLUDED.summary,
       description = EXCLUDED.description,
       tags = EXCLUDED.tags,
       request_schema = EXCLUDED.request_schema,
       response_schema = EXCLUDED.response_schema,
       auth_required = EXCLUDED.auth_required,
       active = true,
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      parsed.method,
      parsed.path,
      parsed.summary ?? null,
      parsed.description ?? null,
      JSON.stringify(parsed.tags ?? []),
      parsed.request_schema ? JSON.stringify(parsed.request_schema) : null,
      parsed.response_schema ? JSON.stringify(parsed.response_schema) : null,
      parsed.auth_required,
      createdBy,
    ],
    tenantId,
  );
  return rows[0];
}

export async function listEndpoints(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM api_endpoints WHERE tenant_id = $1 AND active = true ORDER BY path, method`,
    [tenantId],
    tenantId,
  );
}

export async function generateOpenApi(tenantId: string, input: unknown, publishedBy: string) {
  await requireTier(tenantId, 'generateOpenApi');
  const parsed = GenerateOpenApiSchema.parse(input ?? {});

  if (parsed.publish) {
    await requireTier(tenantId, 'publishDocs');
  }
  await requireTier(tenantId, 'versioning');

  const endpoints = await listEndpoints(tenantId);

  const paths: Record<string, any> = {};
  for (const ep of endpoints) {
    const pathKey = ep.path as string;
    const methodKey = (ep.method as string).toLowerCase();
    if (!paths[pathKey]) paths[pathKey] = {};

    const tags = typeof ep.tags === 'string' ? JSON.parse(ep.tags) : ep.tags ?? [];
    const operation: Record<string, unknown> = {
      summary: ep.summary ?? undefined,
      description: ep.description ?? undefined,
      tags: Array.isArray(tags) ? tags : [],
      responses: {
        '200': {
          description: 'Success',
          content: ep.response_schema
            ? {
                'application/json': {
                  schema:
                    typeof ep.response_schema === 'string'
                      ? JSON.parse(ep.response_schema)
                      : ep.response_schema,
                },
              }
            : undefined,
        },
      },
    };

    if (ep.auth_required) {
      operation.security = [{ bearerAuth: [] }];
    }

    if (ep.request_schema && ['post', 'put', 'patch'].includes(methodKey)) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema:
              typeof ep.request_schema === 'string'
                ? JSON.parse(ep.request_schema)
                : ep.request_schema,
          },
        },
      };
    }

    paths[pathKey][methodKey] = operation;
  }

  const openapiDoc = {
    openapi: '3.0.3',
    info: {
      title: parsed.title,
      version: parsed.version,
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };

  const rows = await withTenantQuery(
    `INSERT INTO api_doc_versions (
       tenant_id, version, title, openapi_doc, published, published_by, published_at
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6, CASE WHEN $5 THEN NOW() ELSE NULL END)
     ON CONFLICT (tenant_id, version) DO UPDATE SET
       title = EXCLUDED.title,
       openapi_doc = EXCLUDED.openapi_doc,
       published = EXCLUDED.published,
       published_by = EXCLUDED.published_by,
       published_at = EXCLUDED.published_at
     RETURNING *`,
    [
      tenantId,
      parsed.version,
      parsed.title,
      JSON.stringify(openapiDoc),
      parsed.publish,
      publishedBy,
    ],
    tenantId,
  );

  return { version: rows[0], openapi: openapiDoc };
}

export async function listDocVersions(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT id, tenant_id, version, title, published, published_by, published_at, created_at
     FROM api_doc_versions WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
    tenantId,
  );
}

export async function getDocVersion(tenantId: string, version: string) {
  await requireEnabled(tenantId);
  const rows = await withTenantQuery(
    `SELECT * FROM api_doc_versions WHERE tenant_id = $1 AND version = $2`,
    [tenantId, version],
    tenantId,
  );
  if (!rows.length) throw new AppError('Doc version not found', ErrorCode.NOT_FOUND);
  return rows[0];
}
