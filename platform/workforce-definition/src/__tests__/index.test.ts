import { describe, expect, it } from 'vitest';
import { WorkforceDefinitionSchema } from '../index';

const validDefinition = {
  schema_version: '1.0',
  workforce_id: 'workforce-example',
  version: '1.0.0',
  identity: {
    name: 'Example Workforce',
    title: 'Example Worker',
    persona_ref: 'persona-example',
    worldview: 'Evidence before assumption.',
    voice: 'Clear and direct.',
    humanity_mode: 'Present but bounded.',
    boundaries: ['Do not invent facts.'],
    identity_invariants: ['Preserve identity across modes.']
  },
  domain_capabilities: ['traceability systems', 'compliance analysis'],
  operational_capabilities: {
    skills: ['analysis'],
    tools: ['read_records'],
    workflows: ['review_record'],
    services: ['traceability_review']
  },
  modes: {
    chat: { enabled: true },
    bot: {
      enabled: true,
      trigger_conditions: ['record_received']
    },
    agent: {
      enabled: true,
      allowed_tools: ['read_records']
    }
  },
  authority: {
    permission_scope: ['read:records'],
    hitl_classification: 'required_for_external_action',
    hard_stops: ['No destructive action without human approval.'],
    tenant_scope: ['current_tenant']
  },
  knowledge: {
    domains: ['traceability'],
    sources: ['tenant_records'],
    retrieval_rules: ['Use tenant-scoped sources only.'],
    boundaries: ['Do not infer missing records.']
  },
  memory: {
    conversational: true,
    task: true,
    workforce: true,
    organizational: false,
    evidence: true
  },
  lifecycle: {
    status: 'DRAFT'
  },
  legacy_refs: {
    persona_id: 'persona-001',
    bot_id: 'D-01',
    employee_id: 'E-01',
    agent_id: 'agent-001'
  },
  verification: {
    status: 'UNVERIFIED',
    evidence_ref: 'evidence-001'
  }
};

describe('WorkforceDefinitionSchema', () => {
  it('parses a complete valid definition', () => {
    expect(WorkforceDefinitionSchema.parse(validDefinition)).toEqual(validDefinition);
  });

  it('requires workforce_id', () => {
    const { workforce_id: _, ...missing } = validDefinition;
    expect(() => WorkforceDefinitionSchema.parse(missing)).toThrow();
  });

  it('requires schema_version', () => {
    const { schema_version: _, ...missing } = validDefinition;
    expect(() => WorkforceDefinitionSchema.parse(missing)).toThrow();
  });

  it('rejects unknown top-level properties', () => {
    expect(() =>
      WorkforceDefinitionSchema.parse({
        ...validDefinition,
        unexpected: true
      })
    ).toThrow();
  });

  it('preserves legacy references exactly', () => {
    const parsed = WorkforceDefinitionSchema.parse(validDefinition);
    expect(parsed.legacy_refs).toEqual({
      persona_id: 'persona-001',
      bot_id: 'D-01',
      employee_id: 'E-01',
      agent_id: 'agent-001'
    });
  });

  it('does not turn domain capabilities into authority', () => {
    const definition = {
      ...validDefinition,
      domain_capabilities: ['database administration', 'delete production records'],
      authority: {
        ...validDefinition.authority,
        permission_scope: []
      }
    };

    const parsed = WorkforceDefinitionSchema.parse(definition);

    expect(parsed.domain_capabilities).toContain('delete production records');
    expect(parsed.authority.permission_scope).toEqual([]);
  });

  it('keeps mode declarations separate from authority', () => {
    const definition = {
      ...validDefinition,
      operational_capabilities: {
        ...validDefinition.operational_capabilities,
        tools: ['place_order']
      },
      modes: {
        ...validDefinition.modes,
        agent: {
          enabled: true,
          allowed_tools: ['place_order']
        }
      },
      authority: {
        ...validDefinition.authority,
        permission_scope: []
      }
    };

    const parsed = WorkforceDefinitionSchema.parse(definition);

    expect(parsed.modes.agent.enabled).toBe(true);
    expect(parsed.operational_capabilities.tools).toEqual(['place_order']);
    expect(parsed.modes.agent.allowed_tools).toEqual(['place_order']);
    expect(parsed.authority.permission_scope).toEqual([]);
  });

  it('validates lifecycle status', () => {
    expect(() =>
      WorkforceDefinitionSchema.parse({
        ...validDefinition,
        lifecycle: { status: 'INVALID' }
      })
    ).toThrow();

    expect(
      WorkforceDefinitionSchema.parse({
        ...validDefinition,
        lifecycle: { status: 'ACTIVE' }
      }).lifecycle.status
    ).toBe('ACTIVE');
  });

  it('validates verification status', () => {
    expect(() =>
      WorkforceDefinitionSchema.parse({
        ...validDefinition,
        verification: { status: 'INVALID' }
      })
    ).toThrow();

    expect(
      WorkforceDefinitionSchema.parse({
        ...validDefinition,
        verification: { status: 'VERIFIED' }
      }).verification.status
    ).toBe('VERIFIED');
  });

  it('round-trips without changing the definition', () => {
    const parsed = WorkforceDefinitionSchema.parse(validDefinition);
    const reparsed = WorkforceDefinitionSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('uses an opaque stable workforce_id without imposing a semantic prefix', () => {
    for (const workforce_id of ['wf-123', 'WF-001', 'worker-alpha', '550e8400-e29b-41d4-a716-446655440000']) {
      expect(
        WorkforceDefinitionSchema.parse({
          ...validDefinition,
          workforce_id
        }).workforce_id
      ).toBe(workforce_id);
    }
  });
});
