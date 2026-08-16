import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode, parseUserId } from '@platform/utils';
export { AppError, ErrorCode };

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'helpdesk.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { slaTracking: true, autoAssignment: true }, limits: { agentCount: 10 } };
}

// Injected helper to easily provision agents during verification loops
export async function createAgent(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('Helpdesk disabled', ErrorCode.FORBIDDEN);

  const cleanUserId = parseUserId(data.user_id);
  const countRes = await withTenantQuery('SELECT COUNT(*) as count FROM helpdesk_agents WHERE tenant_id = $1', [tenantId], tenantId);
  if (parseInt(countRes[0]?.count || '0', 10) >= cfg.limits.agentCount) {
    throw new AppError('Agent limits reached', ErrorCode.FORBIDDEN);
  }

  const agentId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO helpdesk_agents (id, tenant_id, user_id, name, email)
    VALUES ($1, $2, $3, $4, $5) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [agentId, tenantId, cleanUserId, data.name, data.email], tenantId);
  return res[0];
}

async function generateTicketNumber(tenantId: string): Promise<string> {
  const res = await withTenantQuery("SELECT COUNT(*) as next FROM tickets WHERE tenant_id = $1", [tenantId], tenantId);
  const nextVal = parseInt(res[0]?.next || '0', 10) + 1;
  const next = nextVal.toString().padStart(5, '0');
  return `TICK-${next}`;
}

function calculateSlaBreachAt(priority: string): Date {
  const hours = { low: 72, normal: 24, high: 8, urgent: 2 }[priority] || 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export async function createTicket(tenantId: string, data: any, requesterId?: string) {
  const cfg = loadConfig();
  const ticketNumber = await generateTicketNumber(tenantId);
  const slaBreachAt = cfg.tiers.slaTracking ? calculateSlaBreachAt(data.priority || 'normal') : null;
  const cleanRequesterId = requesterId ? parseUserId(requesterId) : null;

  const ticketId = crypto.randomUUID();
  const insertQuery = `
    INSERT INTO tickets (id, tenant_id, ticket_number, subject, description, priority, channel, requester_id, requester_email, requester_name, sla_breach_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
  `;
  const res = await withTenantQuery(insertQuery, [
    ticketId, tenantId, ticketNumber, data.subject, data.description, data.priority || 'normal', 
    data.channel || 'web', cleanRequesterId, data.requester_email, data.requester_name || null, slaBreachAt
  ], tenantId);

  return res[0];
}

export async function addMessage(tenantId: string, ticketId: string, body: string, authorId: string | null, authorEmail: string, isInternal = false) {
  const cleanAuthorId = authorId ? parseUserId(authorId) : null;

  const ticketRes = await withTenantQuery('SELECT first_response_at, assigned_to FROM tickets WHERE id = $1 AND tenant_id = $2', [ticketId, tenantId], tenantId);
  const ticket = ticketRes[0];
  if (!ticket) throw new AppError('Ticket not found', ErrorCode.NOT_FOUND);

  const messageId = crypto.randomUUID();
  const messageRes = await withTenantQuery(`
    INSERT INTO ticket_messages (id, tenant_id, ticket_id, author_id, author_email, body, is_internal)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `, [messageId, tenantId, ticketId, cleanAuthorId, authorEmail, body, isInternal], tenantId);

  if (!ticket.first_response_at && authorId && !isInternal) {
    await withTenantQuery('UPDATE tickets SET first_response_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2', [ticketId, tenantId], tenantId);
  }

  return messageRes[0];
}

export async function autoAssignTicket(tenantId: string, ticketId: string) {
  const cfg = loadConfig();
  if (!cfg.tiers.autoAssignment) throw new AppError('Auto assignment disabled', ErrorCode.FORBIDDEN);

  const agentRes = await withTenantQuery(`
    SELECT id FROM helpdesk_agents 
    WHERE tenant_id = $1 AND is_active = true 
    ORDER BY ticket_count ASC LIMIT 1;
  `, [tenantId], tenantId);

  if (agentRes.length === 0) throw new AppError('No active support agents available', ErrorCode.NOT_FOUND);

  const agentId = agentRes[0].id;
  await withTenantQuery('UPDATE tickets SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3', [agentId, ticketId, tenantId], tenantId);
  await withTenantQuery('UPDATE helpdesk_agents SET ticket_count = ticket_count + 1 WHERE id = $1 AND tenant_id = $2', [agentId, tenantId], tenantId);

  return { success: true, assigned_to_agent_id: agentId };
}
