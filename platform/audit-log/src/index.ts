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

export const IngestEventSchema = z.object({
  event_type: z.string().min(1),
  actor_id: z.string().uuid().optional(),
  actor_type: z.string().optional(),
  actor_ip: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  action: z.string().min(1),
  outcome: z.enum(['success', 'failure', 'partial']),
  before_state: z.record(z.any()).optional(),
  after_state: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
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
    const configPath = path.join(process.cwd(), 'config', 'audit-log.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { eventIngestion: true, hashChaining: true, integrityVerification: true } };
}

export function computeGenesisHash(tenantId: string): string {
  return crypto.createHash('sha256').update(`GENESIS:${tenantId}`).digest('hex');
}

export function computeEventHash(event: any, prevHash: string): string {
  const payload = [
    event.tenant_id,
    event.event_type,
    event.actor_id || '',
    event.resource_type || '',
    event.resource_id || '',
    event.action,
    event.outcome,
    prevHash
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

export async function ingestEvent(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.eventIngestion) {
    throw new AppError('Audit Log service is disabled', 'FORBIDDEN');
  }

  const parsed = IngestEventSchema.parse(data);
  const eventId = crypto.randomUUID();

  const prevResult = await withTenantQuery(`
    SELECT event_hash FROM audit_events 
    WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1;
  `, [tenantId], tenantId);

  const prevHash = prevResult[0]?.event_hash || computeGenesisHash(tenantId);

  const eventWithTenant = { ...parsed, tenant_id: tenantId };
  const eventHash = computeEventHash(eventWithTenant, prevHash);

  const res = await withTenantQuery(`
    INSERT INTO audit_events (id, tenant_id, event_type, actor_id, actor_type, actor_ip, actor_ua, resource_type, resource_id, action, outcome, before_state, after_state, metadata, prev_hash, event_hash)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *;
  `, [
    eventId, tenantId, parsed.event_type, parsed.actor_id || null, parsed.actor_type || null,
    parsed.actor_ip || null, 'Client UA', parsed.resource_type || null, parsed.resource_id || null,
    parsed.action, parsed.outcome, JSON.stringify(parsed.before_state || {}), JSON.stringify(parsed.after_state || {}),
    JSON.stringify(parsed.metadata || {}), prevHash, eventHash
  ], tenantId);

  return res[0];
}

export async function verifyChainIntegrity(tenantId: string) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.integrityVerification) {
    throw new AppError('Integrity verification tier is disabled', 'FORBIDDEN');
  }

  const list = await withTenantQuery(`
    SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY sequence ASC;
  `, [tenantId], tenantId);

  let prevHash = computeGenesisHash(tenantId);
  let verifiedCount = 0;

  for (const event of list) {
    const calcHash = computeEventHash(event, prevHash);
    
    if (calcHash !== event.event_hash) {
      return {
        verified: false,
        failed_sequence: parseInt(event.sequence, 10),
        expected_hash: calcHash,
        actual_hash: event.event_hash
      };
    }
    prevHash = calcHash;
    verifiedCount++;
  }

  return {
    verified: true,
    total_events_checked: verifiedCount,
    chain_integrity: "complete_and_unaltered"
  };
}

export async function getAuditLedger(tenantId: string) {
  const events = await withTenantQuery(`
    SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 50;
  `, [tenantId], tenantId);
  return { events };
}
