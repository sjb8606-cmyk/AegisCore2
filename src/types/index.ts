/**
 * Veridact v1.0 — Canonical Type Definitions
 */

export type ActorType = 'system' | 'user' | 'api_key';

export interface Actor {
  type: ActorType;
  id: string;
  metadata?: {
    ip?: string;
    user_agent?: string;
  };
}

export interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export type Diff = DiffEntry[];

export type EventType =
  | 'new_receipt'
  | 'rule_change'
  | 'manual_override'
  | 'system_update'
  | 'replay_match'
  | 'replay_mismatch'
  | 'hash_mismatch';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface VerifyContext {
  source: 'api' | 'internal' | 'replay';
  trigger: 'manual' | 'automated';
  notes?: string;
}

export interface ContextEnvelope {
  idempotency_key?: string;
  input: Record<string, unknown>;
  rules_version: string;
  rules_hash: string;
  context: VerifyContext;
}

export interface Receipt {
  receipt_id: string;
  tenant_id: string;
  idempotency_key?: string;
  event_type: 'new_receipt';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  rules_version: string;
  rules_hash: string;
  hash: string;
  previous_hash: string;
  timestamp: string;
  replayable: true;
  actor: Actor;
  context: VerifyContext;
}

export interface ChangeEntry {
  change_id: string;
  tenant_id: string;
  event_type: 'rule_change' | 'manual_override' | 'system_update';
  timestamp: string;
  actor: Actor;
  action_type: string;
  previous_state_hash: string;
  new_state_hash: string;
  diff: Diff;
  linked_receipt?: string;
}

export interface Alert {
  alert_id: string;
  tenant_id: string;
  event_type: EventType;
  severity: Severity;
  message: string;
  actor: Actor;
  linked_receipt?: string;
  timestamp: string;
  human_message: string;
}

export interface VerifyResponse {
  decision: string;
  receipt_id: string;
  hash: string;
  rules_hash: string;
  timestamp: string;
  replayable: true;
  event_type: 'new_receipt';
  human_message: string;
}

export interface ReplayResponse {
  original_hash: string;
  recomputed_hash: string;
  match: boolean;
  delta: Diff;
  event_type: 'replay_match' | 'replay_mismatch';
  human_message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    has_next: boolean;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  timestamp: string;
  checks: {
    db: 'ok' | 'error';
    cache?: 'ok' | 'error';
  };
}

export const SEVERITY_MAP: Record<EventType, Severity> = {
  rule_change: 'HIGH',
  replay_mismatch: 'HIGH',
  manual_override: 'MEDIUM',
  new_receipt: 'LOW',
  system_update: 'LOW',
  replay_match: 'LOW',
  hash_mismatch: 'HIGH',
};
