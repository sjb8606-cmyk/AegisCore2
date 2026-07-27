/**
 * Veridact — Unit Tests: Questionnaire → Skin Compiler
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

const clinicResponse: QuestionnaireResponse = {
  tenant_id: 'clinic-compiler-test',
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

describe('compileQuestionnaire', () => {
  it('produces all five compiled artifacts', () => {
    const skin = compileQuestionnaire(clinicResponse);
    expect(skin.policyBundle.rules).toHaveLength(3);
    expect(skin.coverageBoundary.allowed_actions).toContain('transfer_to_human');
    expect(skin.intakeSchema.slots.map((s) => s.slot_id)).toEqual([
      'topic',
      'is_existing_customer',
    ]);
    expect(skin.intentSchema.intents).toHaveLength(3);
    expect(skin.routingTable.targets).toHaveLength(3);
  });

  it('registers the compiled PolicyBundle so it is retrievable by hash', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const fetched = getPolicyBundle(skin.policyBundle.rules_version, skin.policyBundle.rules_hash);
    expect(fetched.rules_version).toBe(skin.policyBundle.rules_version);
  });

  it('registers the compiled CoverageBoundary so it is retrievable by tenant', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const fetched = getBoundary(skin.coverageBoundary.boundary_id, clinicResponse.tenant_id);
    expect(fetched.boundary_id).toBe(skin.coverageBoundary.boundary_id);
  });

  it('compiled policy DENIES medical_advice with the given denial_reason', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const decision = evaluatePolicy({ topic: 'medical_advice' }, skin.policyBundle);
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('AI is not authorized to give medical advice.');
  });

  it('compiled policy ALLOWS billing but flags requires_hitl', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const decision = evaluatePolicy({ topic: 'billing' }, skin.policyBundle);
    expect(decision.decision).toBe('ALLOW');
    expect(decision.requires_hitl).toBe(true);
  });

  it('compiled boundary allows the always-included transfer_to_human action', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const decision = checkBoundary(
      { action: 'transfer_to_human', resource_id: 'customer:1', params: {} },
      skin.coverageBoundary
    );
    expect(decision.decision).toBe('ALLOW');
  });

  it('compiled intent schema classifies free text using derived keywords', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const classification = classifyIntent('I have a question about my billing charge', skin.intentSchema);
    expect(classification.intent).toBe('billing');
  });

  it('compiled routing table routes billing to billing-team when available', () => {
    const skin = compileQuestionnaire(clinicResponse);
    const decision = route({ intent: 'billing' }, skin.routingTable, { 'billing-team': true });
    expect(decision.decision).toBe('ROUTED');
    expect(decision.target_id).toBe('billing-team');
  });

  it('throws QuestionnaireValidationError when a DENY topic has no denial_reason', () => {
    const invalid: QuestionnaireResponse = {
      ...clinicResponse,
      tenant_id: 'clinic-invalid-1',
      topics: [
        { topic_id: 'legal_advice', label: 'Legal advice', ai_permission: 'DENY' },
      ],
    };
    expect(() => compileQuestionnaire(invalid)).toThrow(QuestionnaireValidationError);
  });

  it('throws QuestionnaireValidationError when routing to an undefined target_id', () => {
    const invalid: QuestionnaireResponse = {
      ...clinicResponse,
      tenant_id: 'clinic-invalid-2',
      topics: [
        {
          topic_id: 'billing',
          label: 'Billing',
          ai_permission: 'ALLOW_WITH_APPROVAL',
          route_to_target_id: 'nonexistent-team',
        },
      ],
    };
    expect(() => compileQuestionnaire(invalid)).toThrow(QuestionnaireValidationError);
  });

  it('throws QuestionnaireValidationError with zero topics', () => {
    const invalid: QuestionnaireResponse = { ...clinicResponse, tenant_id: 'clinic-invalid-3', topics: [] };
    expect(() => compileQuestionnaire(invalid)).toThrow(QuestionnaireValidationError);
  });
});
