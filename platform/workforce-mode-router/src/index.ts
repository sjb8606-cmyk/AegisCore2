import { z } from 'zod';
import {
  WorkforceDefinitionSchema,
  type WorkforceDefinition
} from '@platform/workforce-definition';
import { WorkforceRegistry } from '@platform/workforce-registry';

export const WorkforceModeSchema = z.enum(['CHAT', 'BOT', 'AGENT']);
export type WorkforceMode = z.infer<typeof WorkforceModeSchema>;

const TriggerContextSchema = z
  .object({
    trigger: z.string().trim().min(1).optional()
  })
  .passthrough();

export const RouterInputSchema = z
  .object({
    workforce_id: z.string().trim().min(1),
    workforce_version: z.string().trim().min(1).optional(),
    tenant_id: z.string().trim().min(1),
    actor_id: z.string().trim().min(1),
    requested_mode: WorkforceModeSchema.optional(),
    trigger_context: TriggerContextSchema.optional(),
    objective: z.string().trim().min(1).optional(),
    required_capabilities: z.array(z.string().trim().min(1)).default([]),
    required_permissions: z.array(z.string().trim().min(1)).default([]),
    correlation_id: z.string().trim().min(1)
  })
  .strict();

export type RouterInput = z.infer<typeof RouterInputSchema>;

export const RoutingReasonSchema = z.enum([
  'EXPLICIT_MODE',
  'CURRENT_MODE_CONTINUATION',
  'BOT_TRIGGER',
  'AGENT_OBJECTIVE',
  'CHAT_DEFAULT'
]);

export type RoutingReason = z.infer<typeof RoutingReasonSchema>;

export const RoutingDecisionSchema = z
  .object({
    workforce_id: z.string().trim().min(1),
    resolved_version: z.string().trim().min(1),
    selected_mode: WorkforceModeSchema,
    reason_code: RoutingReasonSchema,
    runtime_adapter: z.enum(['chat', 'bot', 'agent']),
    allowed_capabilities: z.array(z.string().trim().min(1)),
    authority_context: z.object({
      permission_scope: z.array(z.string()),
      hard_stops: z.array(z.string()),
      tenant_scope: z.array(z.string())
    }).strict(),
    hitl_requirement: z.string().trim().min(1),
    correlation_id: z.string().trim().min(1),
    decision_id: z.string().uuid(),
    timestamp: z.string().datetime()
  })
  .strict();

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export type RoutingErrorCode =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'MODE_NOT_ALLOWED'
  | 'CAPABILITY_NOT_ALLOWED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'INVALID_CONTEXT'
  | 'RUNTIME_UNAVAILABLE';

export class WorkforceRoutingError extends Error {
  readonly code: RoutingErrorCode;

  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = 'WorkforceRoutingError';
    this.code = code;
  }
}

function fail(code: RoutingErrorCode, message: string): never {
  throw new WorkforceRoutingError(code, message);
}

function isTenantAllowed(
  definition: WorkforceDefinition,
  tenantId: string
): boolean {
  return definition.authority.tenant_scope.includes(tenantId);
}

function flattenOperationalCapabilities(
  definition: WorkforceDefinition
): string[] {
  return [
    ...definition.domain_capabilities,
    ...definition.operational_capabilities.skills,
    ...definition.operational_capabilities.tools,
    ...definition.operational_capabilities.workflows,
    ...definition.operational_capabilities.services
  ];
}

function validateVersion(
  definition: WorkforceDefinition,
  requestedVersion: string | undefined
): string {
  if (
    requestedVersion !== undefined &&
    requestedVersion !== definition.version
  ) {
    fail(
      'NOT_FOUND',
      `Workforce version not available: ${definition.workforce_id}@${requestedVersion}`
    );
  }

  return definition.version;
}

function validateRequiredCapabilities(
  definition: WorkforceDefinition,
  requiredCapabilities: string[]
): void {
  const available = new Set(flattenOperationalCapabilities(definition));

  for (const capability of requiredCapabilities) {
    if (!available.has(capability)) {
      fail(
        'CAPABILITY_NOT_ALLOWED',
        `Required capability is not declared: ${capability}`
      );
    }
  }
}

function validateRequiredPermissions(
  definition: WorkforceDefinition,
  requiredPermissions: string[]
): void {
  const allowed = new Set(definition.authority.permission_scope);

  for (const permission of requiredPermissions) {
    if (!allowed.has(permission)) {
      fail(
        'FORBIDDEN',
        `Required permission is not authorized: ${permission}`
      );
    }
  }
}

function selectMode(input: RouterInput, definition: WorkforceDefinition): {
  mode: WorkforceMode;
  reason: RoutingReason;
} {
  if (input.requested_mode !== undefined) {
    return {
      mode: input.requested_mode,
      reason: 'EXPLICIT_MODE'
    };
  }

  const trigger = input.trigger_context?.trigger;
  if (
    trigger !== undefined &&
    definition.modes.bot.enabled &&
    definition.modes.bot.trigger_conditions.includes(trigger)
  ) {
    return {
      mode: 'BOT',
      reason: 'BOT_TRIGGER'
    };
  }

  if (input.objective !== undefined && definition.modes.agent.enabled) {
    return {
      mode: 'AGENT',
      reason: 'AGENT_OBJECTIVE'
    };
  }

  if (definition.modes.chat.enabled) {
    return {
      mode: 'CHAT',
      reason: 'CHAT_DEFAULT'
    };
  }

  fail(
    'MODE_NOT_ALLOWED',
    `No authorized mode is available for workforce: ${definition.workforce_id}`
  );
}

function validateMode(
  definition: WorkforceDefinition,
  mode: WorkforceMode
): void {
  const enabled =
    mode === 'CHAT'
      ? definition.modes.chat.enabled
      : mode === 'BOT'
        ? definition.modes.bot.enabled
        : definition.modes.agent.enabled;

  if (!enabled) {
    fail(
      'MODE_NOT_ALLOWED',
      `Mode ${mode} is not enabled for workforce: ${definition.workforce_id}`
    );
  }

  if (mode === 'BOT' && definition.modes.bot.trigger_conditions.length === 0) {
    fail(
      'CAPABILITY_NOT_ALLOWED',
      `Bot mode has no declared trigger conditions: ${definition.workforce_id}`
    );
  }

  if (
    mode === 'AGENT' &&
    definition.modes.agent.allowed_tools.some(
      (tool) => !definition.operational_capabilities.tools.includes(tool)
    )
  ) {
    fail(
      'CAPABILITY_NOT_ALLOWED',
      `Agent mode declares a tool that is not an operational capability: ${definition.workforce_id}`
    );
  }
}

function modeCapabilities(
  definition: WorkforceDefinition,
  mode: WorkforceMode
): string[] {
  if (mode === 'CHAT') {
    return [...definition.domain_capabilities];
  }

  if (mode === 'BOT') {
    return [
      ...definition.operational_capabilities.skills,
      ...definition.operational_capabilities.tools,
      ...definition.operational_capabilities.workflows,
      ...definition.operational_capabilities.services
    ];
  }

  return [...definition.modes.agent.allowed_tools];
}

function runtimeAdapter(mode: WorkforceMode): 'chat' | 'bot' | 'agent' {
  return mode.toLowerCase() as 'chat' | 'bot' | 'agent';
}

export class WorkforceModeRouter {
  constructor(private readonly registry: WorkforceRegistry) {}

  route(rawInput: unknown): RoutingDecision {
    const parsed = RouterInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      fail('INVALID_CONTEXT', 'Invalid workforce routing context');
    }

    const input = parsed.data;
    const definition = this.registry.get(input.workforce_id);

    if (definition === undefined) {
      fail(
        'NOT_FOUND',
        `Workforce not found: ${input.workforce_id}`
      );
    }

    if (definition.lifecycle.status !== 'ACTIVE') {
      fail(
        'INACTIVE',
        `Workforce is not active: ${input.workforce_id}`
      );
    }

    if (!isTenantAllowed(definition, input.tenant_id)) {
      fail(
        'TENANT_MISMATCH',
        `Workforce is not available to tenant: ${input.tenant_id}`
      );
    }

    const resolvedVersion = validateVersion(
      definition,
      input.workforce_version
    );

    validateRequiredCapabilities(definition, input.required_capabilities);
    validateRequiredPermissions(definition, input.required_permissions);

    const selection = selectMode(input, definition);
    validateMode(definition, selection.mode);

    const decision = {
      workforce_id: definition.workforce_id,
      resolved_version: resolvedVersion,
      selected_mode: selection.mode,
      reason_code: selection.reason,
      runtime_adapter: runtimeAdapter(selection.mode),
      allowed_capabilities: modeCapabilities(definition, selection.mode),
      authority_context: {
        permission_scope: [...definition.authority.permission_scope],
        hard_stops: [...definition.authority.hard_stops],
        tenant_scope: [...definition.authority.tenant_scope]
      },
      hitl_requirement: definition.authority.hitl_classification,
      correlation_id: input.correlation_id,
      decision_id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };

    return RoutingDecisionSchema.parse(decision);
  }
}

export { WorkforceRegistry, WorkforceDefinitionSchema };
