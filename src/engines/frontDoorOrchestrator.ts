/**
 * Veridact — Front Door Orchestrator
 *
 * Assembles Cores 3, 4, and 5 into one conversation pipeline:
 *
 *   1. Intake Engine    — freeze whatever structured data has been collected
 *                         so far (called once the conversation has ended or
 *                         Intake reports complete: true).
 *   2. Intent Classification — classify intent from the full customer-side
 *                         transcript (more signal than any single turn).
 *   3. Routing Engine    — decide who (if anyone) should receive the call,
 *                         given the collected input + classified intent.
 *
 * Per-turn slot filling itself still happens by calling
 * intakeEngine.processTurn() directly, turn by turn — this module only
 * handles the "conversation is done, now decide what happens next" step.
 */

import { freezeIntake, toVerifyInput } from './intakeEngine';
import { classifyIntent, attachIntent } from './intentEngine';
import { route, buildTransferAction } from './routingEngine';
import type { ConversationOutcome, FinalizeConversationParams } from '../types/conversation';

export function finalizeConversation(
  params: FinalizeConversationParams
): ConversationOutcome {
  const { intakeState, intakeSchema, intentSchema, routingTable, availability } = params;

  const artifact = freezeIntake(intakeState, intakeSchema);
  const baseInput = toVerifyInput(artifact);

  const transcript = intakeState.turns
    .filter((turn) => turn.speaker === 'customer')
    .map((turn) => turn.text)
    .join(' ');
  const intentClassification = classifyIntent(transcript, intentSchema);
  const inputWithIntent = attachIntent(baseInput, intentClassification);

  const routingDecision = route(inputWithIntent, routingTable, availability);
  const transferAction = buildTransferAction(routingDecision);

  return {
    artifact,
    verify_input: inputWithIntent,
    intent_classification: intentClassification,
    routing_decision: routingDecision,
    transfer_action: transferAction,
  };
}
