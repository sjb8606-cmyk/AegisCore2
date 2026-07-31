/**
 * Veridact — Questionnaire → Skin Compiler
 *
 * compileQuestionnaire() is now async — compilePolicyBundle awaits
 * registerBundle(tenantId, bundle), which is now DB-backed. coverageBoundary/
 * intake/intent/routing compilers remain synchronous — boundaryStore is
 * still in-memory (its DB conversion is next).
 */

import type {
  DepartmentAnswer,
  QuestionnaireResponse,
  TopicAnswer,
} from '../types/questionnaire';
import type { PolicyBundle, PolicyRule } from '../types/policy';
import type { CoverageBoundary } from '../types/boundary';
import type { IntakeSchema, SlotDefinition } from '../types/intake';
import type { IntentSchema, IntentDefinition } from '../types/intent';
import type { RoutingTable, RoutingTarget, RoutingRule } from '../types/routing';

import { registerBundle } from './policyBundleStore';
import { registerBoundary } from './boundaryStore';

export interface CompiledSkin {
  policyBundle: PolicyBundle;
  coverageBoundary: CoverageBoundary;
  intakeSchema: IntakeSchema;
  intentSchema: IntentSchema;
  routingTable: RoutingTable;
}

export class QuestionnaireValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'QuestionnaireValidationError';
  }
}

function validate(response: QuestionnaireResponse): void {
  if (response.topics.length === 0) {
    throw new QuestionnaireValidationError('At least one topic must be defined.');
  }
  for (const topic of response.topics) {
    if (topic.ai_permission === 'DENY' && !topic.denial_reason) {
      throw new QuestionnaireValidationError(
        `Topic "${topic.topic_id}" is set to DENY but has no denial_reason.`
      );
    }
    if (topic.ai_permission !== 'ALLOW' && !topic.route_to_target_id) {
      throw new QuestionnaireValidationError(
        `Topic "${topic.topic_id}" requires route_to_target_id when ai_permission is not ALLOW.`
      );
    }
  }
  const targetIds = new Set(response.departments.map((d) => d.target_id));
  for (const topic of response.topics) {
    if (topic.route_to_target_id && !targetIds.has(topic.route_to_target_id)) {
      throw new QuestionnaireValidationError(
        `Topic "${topic.topic_id}" routes to unknown target_id "${topic.route_to_target_id}".`
      );
    }
  }
  if (response.fallback_target_id && !targetIds.has(response.fallback_target_id)) {
    throw new QuestionnaireValidationError(
      `fallback_target_id "${response.fallback_target_id}" is not in departments.`
    );
  }
  if (response.escalation_target_id && !targetIds.has(response.escalation_target_id)) {
    throw new QuestionnaireValidationError(
      `escalation_target_id "${response.escalation_target_id}" is not in departments.`
    );
  }
}

function compileIntakeSchema(response: QuestionnaireResponse): IntakeSchema {
  const slots: SlotDefinition[] = [
    {
      slot_id: 'topic',
      description: 'What the caller wants',
      type: 'enum',
      required: true,
      enum_values: response.topics.map((t) => t.topic_id),
      prompt: `Are you calling about ${response.topics.map((t) => t.label.toLowerCase()).join(', ')}?`,
    },
  ];

  if (response.requires_existing_customer_check) {
    slots.push({
      slot_id: 'is_existing_customer',
      description: 'Whether the caller is an existing customer',
      type: 'boolean',
      required: true,
      prompt: `Are you an existing customer of ${response.business_name}?`,
    });
  }

  return {
    schema_id: `${response.tenant_id}-intake-v1`,
    tenant_id: response.tenant_id,
    slots,
  };
}

function deriveKeywords(topic: TopicAnswer): string[] {
  const words = topic.label.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return Array.from(new Set([topic.topic_id.toLowerCase(), topic.label.toLowerCase(), ...words]));
}

function compileIntentSchema(response: QuestionnaireResponse): IntentSchema {
  const intents: IntentDefinition[] = response.topics.map((topic, index) => ({
    intent_id: topic.topic_id,
    description: topic.label,
    keywords: deriveKeywords(topic),
    priority: index + 1,
  }));

  return {
    schema_id: `${response.tenant_id}-intent-v1`,
    tenant_id: response.tenant_id,
    intents,
    unknown_intent_id: 'unknown',
  };
}

async function compilePolicyBundle(response: QuestionnaireResponse): Promise<PolicyBundle> {
  const rules: PolicyRule[] = response.topics.map((topic, index) => {
    if (topic.ai_permission === 'DENY') {
      return {
        rule_id: `deny-${topic.topic_id}`,
        description: `Deny AI handling of ${topic.label}`,
        priority: index + 1,
        conditions: [{ field: 'topic', operator: 'eq', value: topic.topic_id }],
        effect: 'DENY',
        reason: topic.denial_reason!,
      };
    }
    return {
      rule_id: `allow-${topic.topic_id}`,
      description: `Allow AI handling of ${topic.label}`,
      priority: index + 1,
      conditions: [{ field: 'topic', operator: 'eq', value: topic.topic_id }],
      effect: 'ALLOW',
      requires_hitl: topic.ai_permission === 'ALLOW_WITH_APPROVAL',
      reason:
        topic.ai_permission === 'ALLOW_WITH_APPROVAL'
          ? `${topic.label} is allowed but requires human approval.`
          : `${topic.label} is within the AI's authorized scope.`,
    };
  });

  const unregistered: Omit<PolicyBundle, 'rules_hash'> = {
    rules_version: `${response.tenant_id}-v1`,
    default_effect: 'DENY',
    rules,
  };

  return registerBundle(response.tenant_id, unregistered);
}

function compileCoverageBoundary(response: QuestionnaireResponse): CoverageBoundary {
  const allowedActions = Array.from(new Set(['transfer_to_human', ...response.allowed_actions]));

  const boundary: CoverageBoundary = {
    boundary_id: `${response.tenant_id}-boundary-v1`,
    tenant_id: response.tenant_id,
    description: `Coverage boundary for ${response.business_name}`,
    allowed_actions: allowedActions,
    allowed_resource_patterns: response.allowed_resource_patterns,
  };

  return registerBoundary(boundary);
}

function compileRoutingTable(response: QuestionnaireResponse): RoutingTable {
  const targets: RoutingTarget[] = response.departments.map((d: DepartmentAnswer) => ({
    target_id: d.target_id,
    department: d.department,
    description: d.description,
  }));

  const rules: RoutingRule[] = response.topics
    .filter((t) => !!t.route_to_target_id)
    .map((t, index) => ({
      rule_id: `route-${t.topic_id}`,
      priority: index + 1,
      conditions: [{ field: 'intent', operator: 'eq' as const, value: t.topic_id }],
      target_id: t.route_to_target_id!,
    }));

  return {
    table_id: `${response.tenant_id}-routing-v1`,
    tenant_id: response.tenant_id,
    targets,
    rules,
    fallback_target_id: response.fallback_target_id,
    escalation_target_id: response.escalation_target_id,
  };
}

export async function compileQuestionnaire(response: QuestionnaireResponse): Promise<CompiledSkin> {
  validate(response);

  return {
    policyBundle: await compilePolicyBundle(response),
    coverageBoundary: compileCoverageBoundary(response),
    intakeSchema: compileIntakeSchema(response),
    intentSchema: compileIntentSchema(response),
    routingTable: compileRoutingTable(response),
  };
}
