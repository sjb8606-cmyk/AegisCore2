/**
 * Veridact — Front Door Orchestrator Types
 *
 * Ties Intake, Intent Classification, and Routing together into one
 * real conversation pipeline — the "front door" tier: a caller talks,
 * Veridact collects structured data, figures out what they actually want,
 * and decides who (if anyone) should pick up the call.
 *
 * This is the conversational counterpart to the MCP Interceptor, which
 * assembles Boundary → Policy → HITL for tool-call governance instead.
 */

import type { IntakeArtifact, IntakeSchema, IntakeState } from './intake';
import type { IntentClassification, IntentSchema } from './intent';
import type { AvailabilityMap, RoutingDecision, RoutingTable } from './routing';

export interface FinalizeConversationParams {
  intakeState: IntakeState;
  intakeSchema: IntakeSchema;
  intentSchema: IntentSchema;
  routingTable: RoutingTable;
  availability: AvailabilityMap;
}

export interface TransferAction {
  action: string;
  resource_id: string;
  params: Record<string, unknown>;
}

export interface ConversationOutcome {
  artifact: IntakeArtifact;
  verify_input: Record<string, unknown>;
  intent_classification: IntentClassification;
  routing_decision: RoutingDecision;
  transfer_action: TransferAction | null;
}
