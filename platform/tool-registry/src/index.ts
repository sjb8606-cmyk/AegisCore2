/**
 * platform/tool-registry
 *
 * Formal tool contracts + execution registry.
 * Permission boundary: allowedTools list on the call (reuse pattern from bot-runtime).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('tool-registry');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export interface ToolContract {
  name: string;
  riskLevel: number; // 1–5
  reversible: boolean;
  externalImpact: boolean;
  requiresConfirmation: boolean;
  costEstimate: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  description?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: { tenantId: string; actorId: string },
) => Promise<unknown>;

const contracts = new Map<string, ToolContract>();
const handlers = new Map<string, ToolHandler>();

export function __resetToolRegistryStore(): void {
  contracts.clear();
  handlers.clear();
  seedBuiltinTools();
}

function seedBuiltinTools(): void {
  registerTool(
    {
      name: 'noop',
      riskLevel: 1,
      reversible: true,
      externalImpact: false,
      requiresConfirmation: false,
      costEstimate: '$0',
      inputSchema: {},
      outputSchema: { ok: 'boolean' },
      description: 'No-op placeholder',
    },
    async () => ({ ok: true }),
  );

  registerTool(
    {
      name: 'web_search',
      riskLevel: 2,
      reversible: true,
      externalImpact: true,
      requiresConfirmation: false,
      costEstimate: '$0.01',
      inputSchema: { query: 'string' },
      outputSchema: { results: 'array' },
      description: 'Search the web (mock)',
    },
    async (args) => ({
      results: [
        {
          title: `Mock result for: ${args.query}`,
          url: 'https://example.com',
        },
      ],
    }),
  );

  registerTool(
    {
      name: 'run_code',
      riskLevel: 3,
      reversible: true,
      externalImpact: false,
      requiresConfirmation: false,
      costEstimate: '$0.02',
      inputSchema: { code: 'string', language: 'string' },
      outputSchema: { stdout: 'string', exitCode: 'number' },
      description: 'Run code in sandbox (mock — wire sandbox-runtime)',
    },
    async (args) => ({
      stdout: `mock ran \( {args.language || 'js'} ( \){String(args.code || '').length} chars)`,
      exitCode: 0,
    }),
  );

  registerTool(
    {
      name: 'send_email',
      riskLevel: 4,
      reversible: false,
      externalImpact: true,
      requiresConfirmation: true,
      costEstimate: '$0.001',
      inputSchema: { to: 'string', subject: 'string', body: 'string' },
      outputSchema: { messageId: 'string' },
      description: 'Send email (mock)',
    },
    async (args) => ({
      messageId: 'mock-msg-' + crypto.randomUUID().slice(0, 8),
      to: args.to,
    }),
  );

  registerTool(
    {
      name: 'draft_email',
      riskLevel: 1,
      reversible: true,
      externalImpact: false,
      requiresConfirmation: false,
      costEstimate: '$0',
      inputSchema: { to: 'string', subject: 'string', body: 'string' },
      outputSchema: { draftId: 'string' },
      description: 'Draft email without sending',
    },
    async (args) => ({
      draftId: 'draft-' + crypto.randomUUID().slice(0, 8),
      ...args,
    }),
  );

  registerTool(
    {
      name: 'read_calendar',
      riskLevel: 2,
      reversible: true,
      externalImpact: false,
      requiresConfirmation: false,
      costEstimate: '$0',
      inputSchema: { from: 'string', to: 'string' },
      outputSchema: { events: 'array' },
      description: 'Read calendar (mock)',
    },
    async () => ({ events: [] }),
  );

  registerTool(
    {
      name: 'add_calendar_event',
      riskLevel: 3,
      reversible: true,
      externalImpact: true,
      requiresConfirmation: true,
      costEstimate: '$0',
      inputSchema: { title: 'string', start: 'string', end: 'string' },
      outputSchema: { eventId: 'string' },
      description: 'Add calendar event (mock)',
    },
    async (args) => ({
      eventId: 'evt-' + crypto.randomUUID().slice(0, 8),
      title: args.title,
    }),
  );

  registerTool(
    {
      name: 'call_api',
      riskLevel: 3,
      reversible: true,
      externalImpact: true,
      requiresConfirmation: false,
      costEstimate: 'variable',
      inputSchema: { url: 'string', method: 'string' },
      outputSchema: { status: 'number', body: 'unknown' },
      description: 'Generic HTTP call (mock — blocked network by default)',
    },
    async (args) => ({
      status: 200,
      body: { mock: true, url: args.url },
    }),
  );

  registerTool(
    {
      name: 'place_order',
      riskLevel: 5,
      reversible: false,
      externalImpact: true,
      requiresConfirmation: true,
      costEstimate: 'order value',
      inputSchema: { sku: 'string', qty: 'number' },
      outputSchema: { orderId: 'string' },
      description: 'Place order (mock)',
    },
    async (args) => ({
      orderId: 'ord-' + crypto.randomUUID().slice(0, 8),
      sku: args.sku,
      qty: args.qty,
    }),
  );
}

seedBuiltinTools();

export function registerTool(
  contract: ToolContract,
  handler: ToolHandler,
): void {
  if (contract.riskLevel < 1 || contract.riskLevel > 5) {
    throw new AppError('riskLevel must be 1–5', ErrorCode.BAD_REQUEST);
  }
  contracts.set(contract.name, contract);
  handlers.set(contract.name, handler);
}

export function listTools(): ToolContract[] {
  return [...contracts.values()];
}

export function getToolContract(name: string): ToolContract | null {
  return contracts.get(name) || null;
}

/**
 * Permission boundary: caller must pass allowedTools (from agent run / mission).
 */
export function enforcePermissionBoundary(
  toolName: string,
  allowedTools: string[],
): void {
  if (!allowedTools.includes(toolName)) {
    throw new AppError(
      `Tool '${toolName}' not in allowedTools`,
      ErrorCode.FORBIDDEN,
    );
  }
}

export async function executeTool(
  tenantId: string,
  actorId: string,
  input: {
    name: string;
    args?: Record<string, unknown>;
    allowedTools: string[];
  },
): Promise<{ contract: ToolContract; result: unknown }> {
  return runCrudOperation({
    configName: 'tool-registry',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const contract = contracts.get(input.name);
      if (!contract) {
        throw new AppError(`Unknown tool: ${input.name}`, ErrorCode.NOT_FOUND);
      }
      enforcePermissionBoundary(input.name, input.allowedTools || []);

      const handler = handlers.get(input.name);
      if (!handler) {
        throw new AppError(
          `No handler for tool: ${input.name}`,
          ErrorCode.INTERNAL,
        );
      }

      const result = await handler(input.args || {}, { tenantId, actorId });
      logger.info({ tool: input.name }, 'Tool executed');
      return { contract, result };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'tool_execution',
    meterEventType: 'api_call',
  });
}

/** Wire into agent-reasoning setToolFn */
export function toolFnAdapter(allowedTools: string[]) {
  return async (name: string, args: Record<string, unknown>) => {
    // tenant/actor filled by reasoning layer in real wiring
    const contract = contracts.get(name);
    if (!contract) throw new AppError(`Unknown tool: ${name}`, ErrorCode.NOT_FOUND);
    enforcePermissionBoundary(name, allowedTools);
    const handler = handlers.get(name);
    if (!handler) throw new AppError(`No handler: ${name}`, ErrorCode.INTERNAL);
    return handler(args, { tenantId: 'system', actorId: 'agent' });
  };
}
