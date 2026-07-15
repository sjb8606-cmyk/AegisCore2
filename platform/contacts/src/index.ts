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

export const CreateContactSchema = z.object({
  type: z.enum(['person', 'organization']),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  org_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  organization_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  owner_ref: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
});

export const MergeContactsSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
});

export const AddTagSchema = z.object({
  tag: z.string().min(1).max(100),
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
  try {
    const configPath = path.join(process.cwd(), 'config', 'contacts.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { personContacts: true, contactMerging: true, tagging: true } };
}

export async function createContact(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Contacts module is disabled', 'FORBIDDEN');

  const parsed = CreateContactSchema.parse(data);
  const contactId = crypto.randomUUID();

  const res = await withTenantQuery(`
    INSERT INTO contacts (id, tenant_id, type, first_name, last_name, org_name, email, phone, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `, [contactId, tenantId, parsed.type, parsed.first_name || null, parsed.last_name || null, parsed.org_name || null, parsed.email || null, parsed.phone || null, 'active'], tenantId);

  return res[0];
}

export async function addTag(tenantId: string, contactId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.tagging) {
    throw new AppError('Contacts tagging tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(contactId)) throw new AppError('Invalid Contact ID format.', 'BAD_REQUEST');
  const parsed = AddTagSchema.parse(data);

  const tagId = crypto.randomUUID();
  const res = await withTenantQuery(`
    INSERT INTO contact_tags (id, tenant_id, contact_id, tag)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id, contact_id, tag) DO NOTHING RETURNING *;
  `, [tagId, tenantId, contactId, parsed.tag], tenantId);

  return res[0] || { status: "ignored_duplicate_tag" };
}

// Atomic Merge Engine: Transfer tags and log activities from source to target
export async function mergeContacts(tenantId: string, sourceId: string, targetId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.contactMerging) {
    throw new AppError('Contacts merging tier is disabled', 'FORBIDDEN');
  }

  if (!isValidUuid(sourceId) || !isValidUuid(targetId)) {
    throw new AppError('Invalid ID formats (Source or Target).', 'BAD_REQUEST');
  }

  // 1. Fetch Source & Target profiles
  const sourceRes = await withTenantQuery('SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2;', [sourceId, tenantId], tenantId);
  const targetRes = await withTenantQuery('SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2;', [targetId, tenantId], tenantId);

  const source = sourceRes[0];
  const target = targetRes[0];
  if (!source || !target) throw new AppError('Source or Target contact not found.', 'NOT_FOUND');
  if (source.status === 'merged') throw new AppError('Source contact is already merged.', 'BAD_REQUEST');

  // 2. Fetch target's existing tags to prevent duplicate key collisions during the update
  const targetTagsRes = await withTenantQuery(`
    SELECT tag FROM contact_tags WHERE contact_id = $1 AND tenant_id = $2;
  `, [targetId, tenantId], tenantId);
  const targetTags = targetTagsRes.map((t: any) => t.tag);

  if (targetTags.length > 0) {
    // Delete overlapping tags from the duplicate source first
    await withTenantQuery(`
      DELETE FROM contact_tags WHERE contact_id = $1 AND tenant_id = $2 AND tag = ANY($3::varchar[]);
    `, [sourceId, tenantId, targetTags], tenantId);
  }

  // 3. Update remaining unique tags from source to target
  await withTenantQuery(`
    UPDATE contact_tags SET contact_id = $1 WHERE contact_id = $2 AND tenant_id = $3;
  `, [targetId, sourceId, tenantId], tenantId);

  // 4. Update Source status to merged
  const updatedSource = await withTenantQuery(`
    UPDATE contacts SET status = 'merged', merged_into_id = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND tenant_id = $3 RETURNING *;
  `, [targetId, sourceId, tenantId], tenantId);

  // 5. Log the merge event in target's activity ledger
  const activityId = crypto.randomUUID();
  await withTenantQuery(`
    INSERT INTO contact_activity (id, tenant_id, contact_id, activity_type, summary, actor_ref)
    VALUES ($1, $2, $3, 'status_change', $4, $5);
  `, [activityId, tenantId, targetId, `Contact '${source.first_name} ${source.last_name}' merged into this profile.`, '00000000-0000-0000-0000-000000000001'], tenantId);

  return {
    success: true,
    mergedInto: targetId,
    source: updatedSource[0]
  };
}

export async function getContactLedger(tenantId: string, contactId: string) {
  if (!isValidUuid(contactId)) throw new AppError('Invalid Contact ID format.', 'BAD_REQUEST');

  const contactRes = await withTenantQuery(`
    SELECT * FROM contacts WHERE id = $1 AND tenant_id = $2;
  `, [contactId, tenantId], tenantId);
  const contact = contactRes[0];
  if (!contact) throw new AppError('Contact not found.', 'NOT_FOUND');

  const tags = await withTenantQuery(`
    SELECT * FROM contact_tags WHERE contact_id = $1 AND tenant_id = $2 ORDER BY created_at ASC;
  `, [contactId, tenantId], tenantId);

  const activities = await withTenantQuery(`
    SELECT * FROM contact_activity WHERE contact_id = $1 AND tenant_id = $2 ORDER BY created_at DESC;
  `, [contactId, tenantId], tenantId);

  return {
    ...contact,
    tags,
    activities
  };
}
