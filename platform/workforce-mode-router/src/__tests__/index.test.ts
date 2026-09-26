import { describe, expect, it } from 'vitest';
import {
  WorkforceModeRouter,
  WorkforceRoutingError,
  type RouterInput
} from '../index';
import { WorkforceRegistry } from '@platform/workforce-registry';

const baseDefinition = {
  schema_version: '1.0',
  workforce_id: 'workforce-router-test',
  version: '1.0.0',
  identity: {
    name: 'Router Test Workforce'
  },
  domain_capabilities: ['analysis'],
  operational_capabilities: {
    skills: ['review'],
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
    tenant_scope: ['tenant-a']
  },
  knowledge: {
    domains: ['traceability'],
    sources: ['tenant_records'],
    retrieval_rules: ['tenant-scoped'],
    boundaries: ['no inference']
  },
  memory: {
    conversational: true,
    task: true,
    workforce: true,
    organizational: false,
    evidence: true
  },
  lifecycle: {
    status: 'ACTIVE'
  },
  legacy_refs: {},
  verification: {
    status: 'VERIFIED'
  }
};

function makeRouter() {
  const registry = new WorkforceRegistry();
  registry.register(baseDefinition);
  return new WorkforceModeRouter(registry);
}

function input(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    workforce_id: baseDefinition.workforce_id,
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    correlation_id: 'corr-1',
    ...overrides
  };
}

describe('WorkforceModeRouter', () => {
  it('routes an explicit Chat request', () => {
    const result = makeRouter().route(input({ requested_mode: 'CHAT' }));

    expect(result.selected_mode).toBe('CHAT');
    expect(result.reason_code).toBe('EXPLICIT_MODE');
    expect(result.runtime_adapter).toBe('chat');
    expect(result.workforce_id).toBe(baseDefinition.workforce_id);
  });

  it('routes an explicit Bot request', () => {
    const result = makeRouter().route(input({ requested_mode: 'BOT' }));

    expect(result.selected_mode).toBe('BOT');
    expect(result.runtime_adapter).toBe('bot');
  });

  it('routes an explicit Agent request', () => {
    const result = makeRouter().route(input({ requested_mode: 'AGENT' }));

    expect(result.selected_mode).toBe('AGENT');
    expect(result.runtime_adapter).toBe('agent');
  });

  it('rejects an unknown workforce', () => {
    expect(() =>
      makeRouter().route(input({ workforce_id: 'missing' }))
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'NOT_FOUND'
      })
    );
  });

  it('rejects an inactive workforce', () => {
    const registry = new WorkforceRegistry();
    registry.register({
      ...baseDefinition,
      lifecycle: { status: 'SUSPENDED' }
    });

    expect(() =>
      new WorkforceModeRouter(registry).route(input())
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'INACTIVE'
      })
    );
  });

  it('blocks a disabled mode', () => {
    const registry = new WorkforceRegistry();
    registry.register({
      ...baseDefinition,
      modes: {
        ...baseDefinition.modes,
        agent: { enabled: false, allowed_tools: [] }
      }
    });

    expect(() =>
      new WorkforceModeRouter(registry).route(
        input({ requested_mode: 'AGENT' })
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'MODE_NOT_ALLOWED'
      })
    );
  });

  it('denies a cross-tenant workforce without revealing tenant membership', () => {
    expect(() =>
      makeRouter().route(input({ tenant_id: 'tenant-b' }))
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'NOT_FOUND'
      })
    );
  });

  it('rejects missing required capabilities', () => {
    expect(() =>
      makeRouter().route(
        input({
          required_capabilities: ['delete_records']
        })
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'CAPABILITY_NOT_ALLOWED'
      })
    );
  });

  it('rejects missing required permissions', () => {
    expect(() =>
      makeRouter().route(
        input({
          required_permissions: ['write:records']
        })
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'FORBIDDEN'
      })
    );
  });

  it('rejects a mismatched workforce version', () => {
    expect(() =>
      makeRouter().route(
        input({
          workforce_version: '2.0.0'
        })
      )
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'NOT_FOUND'
      })
    );
  });

  it('returns the current registered version when no version is supplied', () => {
    const result = makeRouter().route(input());

    expect(result.resolved_version).toBe('1.0.0');
  });

  it('supports Bot trigger routing', () => {
    const result = makeRouter().route(
      input({
        trigger_context: { trigger: 'record_received' }
      })
    );

    expect(result.selected_mode).toBe('BOT');
    expect(result.reason_code).toBe('BOT_TRIGGER');
  });

  it('does not automatically select Agent for an arbitrary objective', () => {
    const result = makeRouter().route(
      input({
        objective: 'Investigate this record'
      })
    );

    expect(result.selected_mode).toBe('CHAT');
    expect(result.reason_code).toBe('CHAT_DEFAULT');
  });

  it('defaults to Chat for a conversational request', () => {
    const result = makeRouter().route(input());

    expect(result.selected_mode).toBe('CHAT');
    expect(result.reason_code).toBe('CHAT_DEFAULT');
  });

  it('preserves identity and routing context', () => {
    const result = makeRouter().route(
      input({
        workforce_version: '1.0.0',
        actor_id: 'actor-77',
        correlation_id: 'corr-77'
      })
    );

    expect(result.workforce_id).toBe(baseDefinition.workforce_id);
    expect(result.resolved_version).toBe('1.0.0');
    expect(result.correlation_id).toBe('corr-77');
  });

  it('returns authority context without granting new authority', () => {
    const result = makeRouter().route(input());

    expect(result.authority_context.permission_scope).toEqual([
      'read:records'
    ]);
    expect(result.authority_context.tenant_scope).toEqual(['tenant-a']);
    expect(result.hitl_requirement).toBe('required_for_external_action');
  });

  it('does not execute a runtime', () => {
    const result = makeRouter().route(input({ requested_mode: 'AGENT' }));

    expect(result.runtime_adapter).toBe('agent');
  });

  it('produces equivalent routing outcomes for identical inputs', () => {
    const router = makeRouter();
    const first = router.route(input({ requested_mode: 'CHAT' }));
    const second = router.route(input({ requested_mode: 'CHAT' }));

    expect({
      workforce_id: first.workforce_id,
      resolved_version: first.resolved_version,
      selected_mode: first.selected_mode,
      reason_code: first.reason_code,
      runtime_adapter: first.runtime_adapter,
      allowed_capabilities: first.allowed_capabilities,
      authority_context: first.authority_context,
      hitl_requirement: first.hitl_requirement,
      correlation_id: first.correlation_id
    }).toEqual({
      workforce_id: second.workforce_id,
      resolved_version: second.resolved_version,
      selected_mode: second.selected_mode,
      reason_code: second.reason_code,
      runtime_adapter: second.runtime_adapter,
      allowed_capabilities: second.allowed_capabilities,
      authority_context: second.authority_context,
      hitl_requirement: second.hitl_requirement,
      correlation_id: second.correlation_id
    });
  });

  it('rejects malformed routing context', () => {
    expect(() =>
      makeRouter().route({
        workforce_id: baseDefinition.workforce_id
      })
    ).toThrowError(
      expect.objectContaining<Partial<WorkforceRoutingError>>({
        code: 'INVALID_CONTEXT'
      })
    );
  });
});
