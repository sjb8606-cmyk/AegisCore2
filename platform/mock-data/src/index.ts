/**
 * @platform/mock-data
 *
 * Seed templates + deterministic-ish mock record generation for demos/tests.
 * Pure domain core. Tier-gated via @platform/entitlements.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withTenantQuery } from '@platform/tenancy';
import { AppError, ErrorCode, isValidUuid } from '@platform/utils';
import { getTierConfig } from '@platform/entitlements';

export { AppError, ErrorCode };

const FieldSpecSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'email', 'uuid', 'date', 'enum']),
  enum_values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const CreateTemplateSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  entity_type: z.string().min(1).max(100),
  field_specs: z.array(FieldSpecSchema).min(1),
});

export const GenerateSchema = z.object({
  template_id: z.string().uuid().optional(),
  entity_type: z.string().min(1).max(100).optional(),
  field_specs: z.array(FieldSpecSchema).optional(),
  count: z.number().int().positive().max(500).default(10),
});

async function requireEnabled(tenantId: string) {
  if (!isValidUuid(tenantId)) {
    throw new AppError('Invalid tenant id', ErrorCode.BAD_REQUEST);
  }
  const cfg = await getTierConfig(tenantId, 'mock-data');
  if (!cfg.enabled) {
    throw new AppError('Mock data is disabled', ErrorCode.FORBIDDEN);
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

function generateValue(spec: z.infer<typeof FieldSpecSchema>, index: number): unknown {
  switch (spec.type) {
    case 'uuid':
      return randomUUID();
    case 'email':
      return `user${index}@example.test`;
    case 'boolean':
      return index % 2 === 0;
    case 'number': {
      const min = spec.min ?? 0;
      const max = spec.max ?? 1000;
      return min + (index % Math.max(1, max - min + 1));
    }
    case 'date':
      return new Date(Date.UTC(2024, 0, 1 + (index % 28))).toISOString().slice(0, 10);
    case 'enum': {
      const values = spec.enum_values?.length ? spec.enum_values : ['a', 'b', 'c'];
      return values[index % values.length];
    }
    case 'string':
    default:
      return `\( {spec.key}_ \){index}`;
  }
}

function generateRecords(
  fieldSpecs: z.infer<typeof FieldSpecSchema>[],
  count: number,
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const row: Record<string, unknown> = { id: randomUUID() };
    for (const spec of fieldSpecs) {
      row[spec.key] = generateValue(spec, i);
    }
    records.push(row);
  }
  return records;
}

export async function createTemplate(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'seedTemplates');
  const parsed = CreateTemplateSchema.parse(input);

  const countRows = await withTenantQuery(
    `SELECT COUNT(*)::int AS cnt FROM mock_templates WHERE tenant_id = $1`,
    [tenantId],
    tenantId,
  );
  const max = cfg.limits?.maxTemplatesPerTenant ?? 50;
  if ((countRows[0]?.cnt ?? 0) >= max) {
    throw new AppError(`Template limit (${max}) reached`, ErrorCode.QUOTA_EXCEEDED ?? 'QUOTA_EXCEEDED');
  }

  const rows = await withTenantQuery(
    `INSERT INTO mock_templates (tenant_id, key, name, description, entity_type, field_specs, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING *`,
    [
      tenantId,
      parsed.key,
      parsed.name,
      parsed.description ?? null,
      parsed.entity_type,
      JSON.stringify(parsed.field_specs),
      createdBy,
    ],
    tenantId,
  );
  return rows[0];
}

export async function listTemplates(tenantId: string) {
  await requireEnabled(tenantId);
  return withTenantQuery(
    `SELECT * FROM mock_templates WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
    tenantId,
  );
}

export async function generateMockData(tenantId: string, input: unknown, createdBy: string) {
  const cfg = await requireTier(tenantId, 'generateRecords');
  const parsed = GenerateSchema.parse(input);

  const maxCount = cfg.limits?.maxRecordsPerGenerate ?? 500;
  if (parsed.count > maxCount) {
    throw new AppError(`Count exceeds max (${maxCount})`, ErrorCode.BAD_REQUEST);
  }

  if (parsed.count > 50) {
    await requireTier(tenantId, 'bulkGenerate');
  }

  let fieldSpecs = parsed.field_specs;
  let entityType = parsed.entity_type;
  let templateId = parsed.template_id ?? null;

  if (parsed.template_id) {
    if (!isValidUuid(parsed.template_id)) {
      throw new AppError('Invalid template id', ErrorCode.BAD_REQUEST);
    }
    const templates = await withTenantQuery(
      `SELECT * FROM mock_templates WHERE id = $1 AND tenant_id = $2`,
      [parsed.template_id, tenantId],
      tenantId,
    );
    if (!templates.length) {
      throw new AppError('Template not found', ErrorCode.NOT_FOUND);
    }
    const t = templates[0];
    fieldSpecs = typeof t.field_specs === 'string' ? JSON.parse(t.field_specs) : t.field_specs;
    entityType = t.entity_type;
    templateId = t.id;
  }

  if (!fieldSpecs?.length || !entityType) {
    throw new AppError('Provide template_id or entity_type + field_specs', ErrorCode.BAD_REQUEST);
  }

  const records = generateRecords(fieldSpecs, parsed.count);
  const sample = records.slice(0, Math.min(5, records.length));

  const rows = await withTenantQuery(
    `INSERT INTO mock_generation_runs (
       tenant_id, template_id, entity_type, record_count, status, sample, created_by
     ) VALUES ($1,$2,$3,$4,'completed',$5::jsonb,$6)
     RETURNING *`,
    [tenantId, templateId, entityType, parsed.count, JSON.stringify(sample), createdBy],
    tenantId,
  );

  return {
    run: rows[0],
    records,
  };
}
