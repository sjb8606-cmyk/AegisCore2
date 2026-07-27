/**
 * Veridact — Questionnaire Types
 *
 * The questionnaire is what a business actually fills out at onboarding.
 * Answers are structured (not free text) so compilation into rule objects
 * is deterministic — the same answers always produce the same skin.
 *
 * v1 scope: enough to produce a working PolicyBundle, CoverageBoundary,
 * IntakeSchema, IntentSchema, and RoutingTable for a single-topic-list
 * front-door + governance setup. Multi-slot intake (beyond topic +
 * existing-customer check) is a future extension, not v1.
 */

export type TopicPermission = 'ALLOW' | 'ALLOW_WITH_APPROVAL' | 'DENY';

export interface TopicAnswer {
  topic_id: string;
  label: string;
  ai_permission: TopicPermission;
  denial_reason?: string;
  route_to_target_id?: string;
}

export interface DepartmentAnswer {
  target_id: string;
  department: string;
  description: string;
}

export interface QuestionnaireResponse {
  tenant_id: string;
  business_name: string;
  topics: TopicAnswer[];
  requires_existing_customer_check: boolean;
  departments: DepartmentAnswer[];
  fallback_target_id: string | null;
  escalation_target_id: string | null;
  allowed_actions: string[];
  allowed_resource_patterns: string[];
}
