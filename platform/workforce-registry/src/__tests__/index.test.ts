import { describe, expect, it } from 'vitest';
import { WorkforceRegistry } from '../index';

function makeDefinition(overrides: Record<string, unknown> = {}) {
  return {
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
    domain_capabilities: ['traceability systems'],
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
    },
    ...overrides
  };
}

describe('WorkforceRegistry', () => {
  it('registers a valid definition and returns the parsed value', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    const registered = registry.register(definition);

    expect(registered).toEqual(definition);
    expect(registry.get('workforce-example')).toEqual(definition);
  });

  it('rejects invalid input through the registry schema validation', () => {
    const registry = new WorkforceRegistry();
    const invalid = makeDefinition({
      workforce_id: 'invalid-example',
      lifecycle: { status: 'NOT_A_LIFECYCLE_STATUS' }
    });

    expect(() => registry.register(invalid)).toThrow();
    expect(registry.get('invalid-example')).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('rejects duplicate workforce_id and leaves the original unchanged', () => {
    const registry = new WorkforceRegistry();
    const original = makeDefinition();
    const duplicate = makeDefinition({
      identity: {
        ...original.identity,
        name: 'Attempted Replacement'
      }
    });

    registry.register(original);

    expect(() => registry.register(duplicate)).toThrow(
      'WorkforceDefinition already registered: workforce-example'
    );
    expect(registry.get('workforce-example')).toEqual(original);
  });

  it('returns the stored definition for a known workforce_id', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    expect(registry.get('workforce-example')).toEqual(definition);
  });

  it('returns undefined for an unknown workforce_id', () => {
    const registry = new WorkforceRegistry();

    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('lists all and only registered definitions', () => {
    const registry = new WorkforceRegistry();
    const first = makeDefinition({ workforce_id: 'workforce-one' });
    const second = makeDefinition({
      workforce_id: 'workforce-two',
      legacy_refs: {
        persona_id: 'persona-002',
        bot_id: 'D-02',
        employee_id: 'E-02',
        agent_id: 'agent-002'
      }
    });

    registry.register(first);
    registry.register(second);

    expect(registry.list()).toHaveLength(2);
    expect(registry.list()).toEqual([first, second]);
  });

  it('finds by persona_id', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    expect(registry.findByLegacyRef('persona_id', 'persona-001')).toEqual([
      definition
    ]);
  });

  it('finds by bot_id', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    expect(registry.findByLegacyRef('bot_id', 'D-01')).toEqual([definition]);
  });

  it('finds by employee_id', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    expect(registry.findByLegacyRef('employee_id', 'E-01')).toEqual([
      definition
    ]);
  });

  it('finds by agent_id', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    expect(registry.findByLegacyRef('agent_id', 'agent-001')).toEqual([
      definition
    ]);
  });

  it('returns an empty array for an unknown legacy reference', () => {
    const registry = new WorkforceRegistry();

    expect(
      registry.findByLegacyRef('persona_id', 'does-not-exist')
    ).toEqual([]);
  });

  it('rejects duplicate legacy_ref values within the same legacy-ref kind', () => {
    const registry = new WorkforceRegistry();
    const first = makeDefinition({ workforce_id: 'workforce-one' });
    const second = makeDefinition({
      workforce_id: 'workforce-two',
      identity: {
        name: 'Second Workforce',
        title: 'Second Worker'
      }
    });

    registry.register(first);

    expect(() => registry.register(second)).toThrow(
      'Legacy reference already registered: persona_id=persona-001'
    );
    expect(registry.get('workforce-one')).toEqual(first);
    expect(registry.get('workforce-two')).toBeUndefined();
    expect(
      registry.findByLegacyRef('persona_id', 'persona-001')
    ).toEqual([first]);
  });

  it('does not allow mutation of a get() result to corrupt the registry', () => {
    const registry = new WorkforceRegistry();
    const definition = makeDefinition();

    registry.register(definition);

    const returned = registry.get('workforce-example')!;
    returned.identity.name = 'Mutated Outside Registry';
    returned.legacy_refs.persona_id = 'persona-mutated';

    const subsequent = registry.get('workforce-example')!;

    expect(subsequent.identity.name).toBe('Example Workforce');
    expect(subsequent.legacy_refs.persona_id).toBe('persona-001');
    expect(
      registry.findByLegacyRef('persona_id', 'persona-001')
    ).toEqual([definition]);
    expect(
      registry.findByLegacyRef('persona_id', 'persona-mutated')
    ).toEqual([]);
  });
});
