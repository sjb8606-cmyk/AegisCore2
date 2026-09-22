/**
 * @platform/schema-builder
 *
 * Dynamic schema / form definition core.
 * Create schemas, add fields, publish versioned snapshots.
 * Pure domain — no Express. Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

export const CreateSchemaSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
});

export const AddFieldSchema = z.object({
  field_key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(255),
  field_type: z.enum([
    'string','number','boolean','date','datetime',
    'email','url','select','multiselect','textarea','file',
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional().nullable(),
  validation: z.record(z.unknown()).optional().nullable(),
  section: z.string().max(100).optional().nullable(),
  sort_order: z.number().int().nonnegative().default(0),
});

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'schema-builder');
  if (!cfg.enabled) {
    throw new AppError('Schema builder is disabled', ErrorCode.FORBIDDEN);
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

export async function createSchema(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'customFields');
  const parsed = CreateSchemaSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM dynamic_schemas WHERE tenant_id = $1 AND status <> 'archived'`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.schemasPerTenant ?? 100;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Schema limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO dynamic_schemas (tenant_id, key, name, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, parsed.key, parsed.name, parsed.description ?? null, createdBy],
    tenantId,
  );
  return rows[0];
}

export async function getSchema(tenantId: string, schemaId: string) {
  await requireEnabled(tenantId);
  if (!isValidUuid(schemaId)) {
    throw new AppError('Invalid schema id', ErrorCode.BAD_REQUEST);
  }
  const rows = await withTenantQuery(
    `SELECT * FROM dynamic_schemas WHERE id = $1 AND tenant_id = $2`,
    [schemaId, tenantId],
    tenantId,
  );
  if (!rows.length) throw new AppError('Schema not found', ErrorCode.NOT_FOUND);
  return rows[0];
}

export async function listSchemas(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM dynamic_schemas WHERE tenant_id = $1 AND status <> 'archived' ORDER BY created_at`,
    [tenantId],
    tenantId,
  );
}

export async function addField(tenantId: string, schemaId: string, input: unknown) {
  const cfg = await requireTier(tenantId, 'customFields');
  const parsed = AddFieldSchema.parse(input);

  if (parsed.field_type === 'file') {
    await requireTier(tenantId, 'fileFields');
  }
  if (parsed.section) {
    await requireTier(tenantId, 'sections');
  }
  if (parsed.validation) {
    await requireTier(tenantId, 'validationRules');
  }

  await getSchema(tenantId, schemaId);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM dynamic_schema_fields WHERE schema_id = $1`,
    [schemaId],
    tenantId,
  );
  const max = cfg.limits?.fieldsPerSchema ?? 100;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Field limit (${max}) reached for schema`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO dynamic_schema_fields (
       tenant_id, schema_id, field_key, label, field_type, required,
       options, validation, section, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
     RETURNING *`,
    [
      tenantId, schemaId, parsed.field_key, parsed.label, parsed.field_type,
      parsed.required,
      parsed.options ? JSON.stringify(parsed.options) : null,
      parsed.validation ? JSON.stringify(parsed.validation) : null,
      parsed.section ?? null,
      parsed.sort_order,
    ],
    tenantId,
  );
  return rows[0];
}

export async function listFields(tenantId: string, schemaId: string) {
  await requireEnabled(tenantId);
  await getSchema(tenantId, schemaId);
  return withTenantQuery(
    `SELECT * FROM dynamic_schema_fields WHERE schema_id = $1 AND tenant_id = $2 ORDER BY sort_order, field_key`,
    [schemaId, tenantId],
    tenantId,
  );
}

export async function publishSchema(tenantId: string, schemaId: string, publishedBy: string) {
  await requireTier(tenantId, 'versioning');
  const schema = await getSchema(tenantId, schemaId);
  const fields = await listFields(tenantId, schemaId);

  const nextVersion = (schema.version ?? 1) + (schema.status === 'published' ? 1 : 0);
  const snapshot = { schema, fields };

  await withTenantQuery(
    `INSERT INTO dynamic_schema_versions (tenant_id, schema_id, version, snapshot, published_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [tenantId, schemaId, nextVersion, JSON.stringify(snapshot), publishedBy],
    tenantId,
  );

  const rows = await withTenantQuery(
    `UPDATE dynamic_schemas
     SET status = 'published', version = $3, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [schemaId, tenantId, nextVersion],
    tenantId,
  );
  return rows[0];
}
