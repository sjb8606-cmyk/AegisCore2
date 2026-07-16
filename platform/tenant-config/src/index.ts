import { withTenantQuery } from '@platform/tenancy';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export class AppError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const CreateNamespaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  access_role: z.string().default('tenant_admin'),
});

export const RegisterSchemaKeySchema = z.object({
  namespace_id: z.string().uuid(),
  config_key: z.string().min(1),
  value_type: z.enum(['string', 'number', 'boolean', 'json', 'secret']),
  required: z.boolean().default(false),
  default_value: z.string().optional(),
  description: z.string().optional(),
});

export const SetConfigValueSchema = z.object({
  namespace_id: z.string().uuid(),
  config_key: z.string().min(1),
  config_value: z.string(),
});

export function isValidUuid(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

export function parseUserId(userId: any): string {
  if (isValidUuid(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, 'BAD_REQUEST');
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'tenant-config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { configStorage: true, schemaValidation: true, versionHistory: true } };
}

export async function createNamespace(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Tenant Config module is disabled', 'FORBIDDEN');

  const parsed = CreateNamespaceSchema.parse(data);
  const namespaceId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO config_namespaces (id, tenant_id, name, description, access_role)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `, [namespaceId, tenantId, parsed.name, parsed.description || null, parsed.access_role], tenantId);

  return res[0];
}

export async function registerSchemaKey(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.schemaValidation) {
    throw new AppError('Schema validation tier is disabled', 'FORBIDDEN');
  }

  const parsed = RegisterSchemaKeySchema.parse(data);
  const schemaId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO config_schemas (id, tenant_id, namespace_id, config_key, value_type, required, default_value, description)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
  `, [schemaId, tenantId, parsed.namespace_id, parsed.config_key, parsed.value_type, parsed.required, parsed.default_value || null, parsed.description || null], tenantId);

  return res[0];
}

export async function setConfigValue(tenantId: string, data: any, userId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.configStorage) {
    throw new AppError('Configuration storage tier is disabled', 'FORBIDDEN');
  }

  const parsed = SetConfigValueSchema.parse(data);
  const cleanUserId = parseUserId(userId);

  // 1. Schema Validation check: If validation rule is registered, enforce type safety
  if (cfg.tiers.schemaValidation) {
    const schemaRes = await withTenantQuery(`
      SELECT * FROM config_schemas WHERE namespace_id = $1 AND config_key = $2 AND tenant_id = $3;
    `, [parsed.namespace_id, parsed.config_key, tenantId], tenantId);

    const schema = schemaRes[0];
    if (schema) {
      if (schema.value_type === 'number') {
        const numValue = Number(parsed.config_value);
        if (isNaN(numValue)) {
          throw new AppError(`Schema Type Mismatch: Config key '${parsed.config_key}' requires a 'number' value. Received: '${parsed.config_value}'.`, 'BAD_REQUEST');
        }
      } else if (schema.value_type === 'boolean') {
        const boolVal = parsed.config_value.toLowerCase();
        if (boolVal !== 'true' && boolVal !== 'false') {
          throw new AppError(`Schema Type Mismatch: Config key '${parsed.config_key}' requires a 'boolean' value ('true'/'false').`, 'BAD_REQUEST');
        }
      }
    }
  }

  // 2. Fetch existing config state to evaluate previous version increments
  const existingConfigRes = await withTenantQuery(`
    SELECT * FROM tenant_configs WHERE namespace_id = $1 AND config_key = $2 AND tenant_id = $3;
  `, [parsed.namespace_id, parsed.config_key, tenantId], tenantId);

  const existing = existingConfigRes[0];
  let finalConfigRecord;

  if (existing) {
    const nextVersion = parseInt(existing.version, 10) + 1;

    finalConfigRecord = await withTenantQuery(`
      UPDATE tenant_configs 
      SET config_value = $1, version = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND tenant_id = $5 RETURNING *;
    `, [parsed.config_value, nextVersion, cleanUserId, existing.id, tenantId], tenantId);

    // Record to append-only version history ledger
    if (cfg.tiers.versionHistory) {
      await withTenantQuery(`
        INSERT INTO tenant_config_history (id, tenant_id, config_id, config_key, previous_value, new_value, version, changed_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `, [crypto.randomUUID(), tenantId, existing.id, parsed.config_key, existing.config_value, parsed.config_value, nextVersion, cleanUserId], tenantId);
    }
  } else {
    const configId = crypto.randomUUID();

    finalConfigRecord = await withTenantQuery(`
      INSERT INTO tenant_configs (id, tenant_id, namespace_id, config_key, config_value, version, updated_by)
      VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING *;
    `, [configId, tenantId, parsed.namespace_id, parsed.config_key, parsed.config_value, cleanUserId], tenantId);

    // Record first version to history ledger
    if (cfg.tiers.versionHistory) {
      await withTenantQuery(`
        INSERT INTO tenant_config_history (id, tenant_id, config_id, config_key, previous_value, new_value, version, changed_by)
        VALUES ($1, $2, $3, $4, null, $5, 1, $6);
      `, [crypto.randomUUID(), tenantId, configId, parsed.config_key, parsed.config_value, cleanUserId], tenantId);
    }
  }

  return finalConfigRecord[0];
}

export async function getNamespaceLedger(tenantId: string, namespaceId: string) {
  if (!isValidUuid(namespaceId)) throw new AppError('Invalid Namespace ID format.', 'BAD_REQUEST');

  const nsRes = await withTenantQuery('SELECT * FROM config_namespaces WHERE id = $1 AND tenant_id = $2;', [namespaceId, tenantId], tenantId);
  const namespace = nsRes[0];
  if (!namespace) throw new AppError('Namespace not found.', 'NOT_FOUND');

  const configs = await withTenantQuery(`
    SELECT c.*, s.value_type, s.required, s.description as key_description
    FROM tenant_configs c
    LEFT JOIN config_schemas s ON c.namespace_id = s.namespace_id AND c.config_key = s.config_key
    WHERE c.namespace_id = $1 AND c.tenant_id = $2
    ORDER BY c.config_key ASC;
  `, [namespaceId, tenantId], tenantId);

  // Fetch full append-only configuration changelogs
  for (const configItem of configs) {
    const history = await withTenantQuery(`
      SELECT * FROM tenant_config_history WHERE config_id = $1 AND tenant_id = $2 ORDER BY version DESC;
    `, [configItem.id, tenantId], tenantId);
    configItem.version_history = history;
  }

  return {
    ...namespace,
    configurations: configs
  };
}
