/**
 * Veridact — Conversation Routes
 *
 * POST /v1/conversation/turn      — process one customer utterance against
 *                                    the current Intake state (or start a
 *                                    new one), return updated state + next
 *                                    prompt.
 * POST /v1/conversation/finalize  — once intake is complete, run Intent
 *                                    Classification + Routing and return
 *                                    the outcome.
 *
 * Stateless by design: the caller holds conversation state between turns.
 * Schema objects are passed in directly rather than looked up by ID, since
 * no store for IntakeSchema/IntentSchema/RoutingTable exists yet.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { createIntakeState, processTurn } from '../engines/intakeEngine';
import { finalizeConversation } from '../engines/frontDoorOrchestrator';
import { readRateLimit } from '../middleware/rateLimiter';
import { requireApiKey, type AuthenticatedRequest } from '../middleware/auth';

export const conversationRouter = Router();

conversationRouter.use(requireApiKey, readRateLimit);

const SlotDefinitionSchema = z.object({
  slot_id: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'enum']),
  required: z.boolean(),
  enum_values: z.array(z.string()).optional(),
  prompt: z.string().min(1),
});

const IntakeSchemaZ = z.object({
  schema_id: z.string().min(1),
  tenant_id: z.string().min(1),
  slots: z.array(SlotDefinitionSchema),
});

const ConversationTurnSchema = z.object({
  turn_id: z.string(),
  speaker: z.enum(['customer', 'ai']),
  text: z.string(),
  timestamp: z.string(),
});

const IntakeStateSchema = z.object({
  schema_id: z.string(),
  tenant_id: z.string(),
  collected: z.record(z.union([z.string(), z.number(), z.boolean()])),
  turns: z.array(ConversationTurnSchema),
  complete: z.boolean(),
});

const IntentDefinitionSchema = z.object({
  intent_id: z.string().min(1),
  description: z.string(),
  keywords: z.array(z.string()),
  priority: z.number(),
});

const IntentSchemaZ = z.object({
  schema_id: z.string().min(1),
  tenant_id: z.string().min(1),
  intents: z.array(IntentDefinitionSchema),
  unknown_intent_id: z.string().min(1),
});

const RoutingConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'exists', 'not_exists']),
  value: z.unknown().optional(),
});

const RoutingTargetSchema = z.object({
  target_id: z.string().min(1),
  department: z.string(),
  description: z.string(),
});

const RoutingRuleSchema = z.object({
  rule_id: z.string().min(1),
  priority: z.number(),
  conditions: z.array(RoutingConditionSchema),
  target_id: z.string().min(1),
});

const RoutingTableZ = z.object({
  table_id: z.string().min(1),
  tenant_id: z.string().min(1),
  targets: z.array(RoutingTargetSchema),
  rules: z.array(RoutingRuleSchema),
  fallback_target_id: z.string().nullable(),
  escalation_target_id: z.string().nullable(),
});

const TurnRequestSchema = z.object({
  intake_state: IntakeStateSchema.nullable(),
  intake_schema: IntakeSchemaZ,
  customer_text: z.string().min(1),
});

conversationRouter.post('/conversation/turn', (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const parsed = TurnRequestSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { intake_state, intake_schema, customer_text } = parsed.data;

    const state = intake_state ?? createIntakeState(intake_schema);
    const result = processTurn(state, intake_schema, customer_text);

    res.status(200).json({
      intake_state: result.state,
      next_prompt: result.next_prompt,
    });
  } catch (err) {
    next(err);
  }
});

const FinalizeRequestSchema = z.object({
  intake_state: IntakeStateSchema,
  intake_schema: IntakeSchemaZ,
  intent_schema: IntentSchemaZ,
  routing_table: RoutingTableZ,
  availability: z.record(z.boolean()),
});

conversationRouter.post(
  '/conversation/finalize',
  (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const parsed = FinalizeRequestSchema.safeParse(req.body);
      if (!parsed.success) throw parsed.error;

      const { intake_state, intake_schema, intent_schema, routing_table, availability } = parsed.data;

      const outcome = finalizeConversation({
        intakeState: intake_state,
        intakeSchema: intake_schema,
        intentSchema: intent_schema,
        routingTable: routing_table,
        availability,
      });

      res.status(200).json(outcome);
    } catch (err) {
      next(err);
    }
  }
);
