/**
 * Veridact — Unit Tests: Questionnaire → Skin Compiler (DB-backed)
 */

import { describe, it, expect } from 'vitest';
import {
  compileQuestionnaire,
  QuestionnaireValidationError,
} from '../../src/engines/questionnaireCompiler';
import { getPolicyBundle } from '../../src/engines/policyBundleStore';
import { getBoundary } from '../../src/engines/boundaryStore';
import { evaluatePolicy } from '../../src/engines/policyEngine';
import { checkBoundary } from '../../src/engines/boundaryEngine';
import { classifyIntent } from '../../src/engines/intentEngine';
import { route } from '../../src/engines/routingEngine';
import type { QuestionnaireResponse } from '../../src/types/questionnaire';

const TENANT_MAIN = '33333333-3333-3333-3333-333333333333';
const TENANT_INVALID_1 = '44444444-4444-4444-4444-444444444444';
const TENANT_INVALID_2 = '55555555-5555-5555-5555-555555555555';
const TENANT_INVALID_3 = '66666666-6666-6666-6666-666666666666';

const clinicResponse: QuestionnaireResponse = {
  tenant_id: TENANT_MAIN,
  business_name: 'Riverbend Clinic',
  requires_existing_customer_check: true,
  topics: [
    {
      topic_id: 'appointment',
      label: 'Appointment scheduling',
      ai_permission: 'ALLOW',
    },
    {
      topic_id: 'billing',
      label: 'Billing questions',
      ai_permission: 'ALLOW_WITH_APPROVAL',
      route_to_target_id: 'billing-team',
    },
    {
      topic_id: 'medical_advice',
      label: 'Medical advice',
      ai_permission: 'DENY',
      denial_reason: 'AI is not authorized to give medical advice.',
      route_to_target_id: 'nurse-line',
    },
  ],
  departments: [
    { target_id: 'billing-team', department: 'Billing', description: 'Billing dept' },
    { target_id: 'nurse-line', department: 'Nursing', description: 'Nurse line' },
    { target_id: 'general-queue', department: 'General', description: 'General queue' },
  ],
  fallback_target_id: 'general-queue',
  escalation_target_id: null,
  allowed_actions: ['create_incident_record'],
  allowed_resource_patterns: ['customer:*'],
};

describe('compileQuestionnaire (async, DB-backed)', () => {
  it('produces all five compiled artifacts', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    expect(skin.policyBundle.rules).toHaveLength(3);
    expect(skin.coverageBoundary.allowed_actions).toContain('transfer_to_human');
    expect(skin.intakeSchema.slots.map((s) => s.slot_id)).toEqual([
      'topic',
      'is_existing_customer',
    ]);
    expect(skin.intentSchema.intents).toHaveLength(3);
    expect(skin.routingTable.targets).toHaveLength(3);
  });

  it('registers the compiled PolicyBundle in the DB, retrievable by hash', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const fetched = await getPolicyBundle(
      TENANT_MAIN,
      skin.policyBundle.rules_version,
      skin.policyBundle.rules_hash
    );
    expect(fetched.rules_version).toBe(skin.policyBundle.rules_version);
  });

  it('registers the compiled CoverageBoundary so it is retrievable by tenant', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const fetched = await getBoundary(skin.coverageBoundary.boundary_id, TENANT_MAIN);
    expect(fetched.boundary_id).toBe(skin.coverageBoundary.boundary_id);
  });

  it('compiled policy DENIES medical_advice with the given denial_reason', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const decision = evaluatePolicy({ topic: 'medical_advice' }, skin.policyBundle);
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('AI is not authorized to give medical advice.');
  });

  it('compiled policy ALLOWS billing but flags requires_hitl', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const decision = evaluatePolicy({ topic: 'billing' }, skin.policyBundle);
    expect(decision.decision).toBe('ALLOW');
    expect(decision.requires_hitl).toBe(true);
  });

  it('compiled boundary allows the always-included transfer_to_human action', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const decision = checkBoundary(
      { action: 'transfer_to_human', resource_id: 'customer:1', params: {} },
      skin.coverageBoundary
    );
    expect(decision.decision).toBe('ALLOW');
  });

  it('compiled intent schema classifies free text using derived keywords', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const classification = classifyIntent(
      'I have a question about my billing charge',
      skin.intentSchema
    );
    expect(classification.intent).toBe('billing');
  });

  it('compiled routing table routes billing to billing-team when available', async () => {
    const skin = await compileQuestionnaire(clinicResponse);
    const decision = route({ intent: 'billing' }, skin.routingTable, { 'billing-team': true });
    expect(decision.decision).toBe('ROUTED');
    expect(decision.target_id).toBe('billing-team');
  });

  it('throws QuestionnaireValidationError when a DENY topic has no denial_reason', async () => {
    const invalid: QuestionnaireResponse = {
      ...clinicResponse,
      tenant_id: TENANT_INVALID_1,
      topics: [
        { topic_id: 'legal_advice', label: 'Legal advice', ai_permission: 'DENY' },
      ],
    };
    await expect(compileQuestionnaire(invalid)).rejects.toThrow(QuestionnaireValidationError);
  });

  it('throws QuestionnaireValidationError when routing to an undefined target_id', async () => {
    const invalid: QuestionnaireResponse = {
      ...clinicResponse,
      tenant_id: TENANT_INVALID_2,
      topics: [
        {
          topic_id: 'billing',
          label: 'Billing',
          ai_permission: 'ALLOW_WITH_APPROVAL',
          route_to_target_id: 'nonexistent-team',
        },
      ],
    };
    await expect(compileQuestionnaire(invalid)).rejects.toThrow(QuestionnaireValidationError);
  });

  it('throws QuestionnaireValidationError with zero topics', async () => {
    const invalid: QuestionnaireResponse = {
      ...clinicResponse,
      tenant_id: TENANT_INVALID_3,
      topics: [],
    };
    await expect(compileQuestionnaire(invalid)).rejects.toThrow(QuestionnaireValidationError);
  });
});
