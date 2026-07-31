/**
 * Veridact — Integration Tests: Conversation Routes
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const API_KEY = 'test-api-key-dev';
const TENANT_ID = '00000000-0000-0000-0000-000000000002';
const AUTH_HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'X-Tenant-ID': TENANT_ID,
};

process.env.VERIDACT_DEV_API_KEY = API_KEY;
process.env.VERIDACT_DEV_TENANT_ID = TENANT_ID;
process.env.NODE_ENV = 'test';

const app = createApp();

const intakeSchema = {
  schema_id: 'clinic-intake-v1',
  tenant_id: TENANT_ID,
  slots: [
    {
      slot_id: 'topic',
      description: 'What the caller wants',
      type: 'enum',
      required: true,
      enum_values: ['appointment', 'billing', 'medical_advice'],
      prompt: 'Are you calling about an appointment, billing, or a medical question?',
    },
    {
      slot_id: 'is_existing_patient',
      description: 'Whether caller is an existing patient',
      type: 'boolean',
      required: true,
      prompt: 'Are you an existing patient with us?',
    },
  ],
};

const intentSchema = {
  schema_id: 'clinic-intent-v1',
  tenant_id: TENANT_ID,
  unknown_intent_id: 'unknown',
  intents: [
    {
      intent_id: 'billing_inquiry',
      description: 'Billing question',
      keywords: ['bill', 'charge', 'invoice'],
      priority: 1,
    },
  ],
};

const routingTable = {
  table_id: 'clinic-routing-v1',
  tenant_id: TENANT_ID,
  targets: [
    { target_id: 'billing-team', department: 'Billing', description: 'Billing dept' },
    { target_id: 'general-queue', department: 'General', description: 'General queue' },
  ],
  rules: [
    {
      rule_id: 'route-billing',
      priority: 1,
      conditions: [{ field: 'intent', operator: 'eq', value: 'billing_inquiry' }],
      target_id: 'billing-team',
    },
  ],
  fallback_target_id: 'general-queue',
  escalation_target_id: null,
};

describe('POST /v1/conversation/turn', () => {
  it('starts a new conversation when intake_state is null', async () => {
    const res = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({
        intake_state: null,
        intake_schema: intakeSchema,
        customer_text: 'I have a question about my billing',
      });

    expect(res.status).toBe(200);
    expect(res.body.intake_state.collected.topic).toBe('billing');
    expect(res.body.next_prompt).toBe('Are you an existing patient with us?');
  });

  it('continues an existing conversation using the returned state', async () => {
    const first = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({ intake_state: null, intake_schema: intakeSchema, customer_text: 'appointment' });

    const second = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({
        intake_state: first.body.intake_state,
        intake_schema: intakeSchema,
        customer_text: 'yes, existing patient',
      });

    expect(second.status).toBe(200);
    expect(second.body.intake_state.complete).toBe(true);
    expect(second.body.next_prompt).toBeNull();
  });

  it('returns 400 for an invalid body', async () => {
    const res = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({ intake_schema: intakeSchema });

    expect(res.status).toBe(400);
  });

  it('returns 401 with no auth', async () => {
    const res = await request(app)
      .post('/v1/conversation/turn')
      .send({ intake_state: null, intake_schema: intakeSchema, customer_text: 'hi' });

    expect(res.status).toBe(401);
  });
});

describe('POST /v1/conversation/finalize', () => {
  it('runs the full pipeline and returns a routing decision', async () => {
    const t1 = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({
        intake_state: null,
        intake_schema: intakeSchema,
        customer_text: 'I have a question about my billing charge',
      });

    const t2 = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({
        intake_state: t1.body.intake_state,
        intake_schema: intakeSchema,
        customer_text: 'yes I am an existing patient',
      });

    const res = await request(app)
      .post('/v1/conversation/finalize')
      .set(AUTH_HEADERS)
      .send({
        intake_state: t2.body.intake_state,
        intake_schema: intakeSchema,
        intent_schema: intentSchema,
        routing_table: routingTable,
        availability: { 'billing-team': true },
      });

    expect(res.status).toBe(200);
    expect(res.body.routing_decision.decision).toBe('ROUTED');
    expect(res.body.routing_decision.target_id).toBe('billing-team');
    expect(res.body.transfer_action.action).toBe('transfer_to_human');
  });

  it('returns QUEUED with a null transfer_action when nobody is available', async () => {
    const t1 = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({ intake_state: null, intake_schema: intakeSchema, customer_text: 'billing charge' });

    const t2 = await request(app)
      .post('/v1/conversation/turn')
      .set(AUTH_HEADERS)
      .send({ intake_state: t1.body.intake_state, intake_schema: intakeSchema, customer_text: 'yes' });

    const res = await request(app)
      .post('/v1/conversation/finalize')
      .set(AUTH_HEADERS)
      .send({
        intake_state: t2.body.intake_state,
        intake_schema: intakeSchema,
        intent_schema: intentSchema,
        routing_table: routingTable,
        availability: {},
      });

    expect(res.status).toBe(200);
    expect(res.body.routing_decision.decision).toBe('QUEUED');
    expect(res.body.transfer_action).toBeNull();
  });

  it('returns 401 with no auth', async () => {
    const res = await request(app).post('/v1/conversation/finalize').send({});
    expect(res.status).toBe(401);
  });
});
