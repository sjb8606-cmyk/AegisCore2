import { describe, it, expect } from 'vitest';
import { AuditEventSchema } from '../schema';
import { randomUUID } from 'crypto';

describe('AuditEventSchema — real validation, not mocked', () => {
  const baseEvent = {
    id: randomUUID(),
    tenantId: '11111111-1111-1111-1111-111111111111',
    actorId: '22222222-2222-2222-2222-222222222222',
    actorType: 'user' as const,
    outcome: 'success' as const,
    timestamp: new Date().toISOString(),
  };

  it('accepts the new compliance.investigation_opened action', () => {
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'compliance.investigation_opened' })).not.toThrow();
  });

  it('accepts the new compliance.investigation_resolved action', () => {
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'compliance.investigation_resolved' })).not.toThrow();
  });

  it('accepts the new compliance.rule_version_created action', () => {
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'compliance.rule_version_created' })).not.toThrow();
  });

  it('REJECTS a made-up action string — proving the schema really is enforced, not permissive', () => {
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'totally_made_up.action' })).toThrow();
  });

  it('confirms crm and delight already used genuinely valid values', () => {
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'data.created' })).not.toThrow();
    expect(() => AuditEventSchema.parse({ ...baseEvent, action: 'ai.safety_violation' })).not.toThrow();
  });
});
