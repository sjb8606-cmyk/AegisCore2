/**
 * Veridact — Unit Tests: Coverage Boundary Engine
 */

import { describe, it, expect } from 'vitest';
import { checkBoundary } from '../../src/engines/boundaryEngine';
import type { CoverageBoundary } from '../../src/types/boundary';

const boundary: CoverageBoundary = {
  boundary_id: 'test-boundary',
  tenant_id: 'tenant-1',
  description: 'Test boundary',
  allowed_actions: ['revoke_api_key', 'transfer_to_human'],
  allowed_resource_patterns: ['customer:*', 'invoice:INV-*'],
  field_constraints: {
    severity: { allowed_values: ['low', 'medium', 'high'] },
    amount: { numeric: { min: 0, max: 1000 } },
  },
};

describe('checkBoundary', () => {
  it('allows an action within all constraints', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:12345', params: { severity: 'high' } },
      boundary
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('denies an action not in allowed_actions', () => {
    const result = checkBoundary(
      { action: 'delete_account', resource_id: 'customer:12345', params: {} },
      boundary
    );
    expect(result.decision).toBe('DENY');
    expect(result.failed_check).toBe('action');
  });

  it('denies a resource_id that does not match any pattern', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'employee:99', params: {} },
      boundary
    );
    expect(result.decision).toBe('DENY');
    expect(result.failed_check).toBe('resource_pattern');
  });

  it('matches glob patterns with a fixed prefix', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'invoice:INV-2026-001', params: {} },
      boundary
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('denies a field value outside its allowed_values', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:1', params: { severity: 'critical' } },
      boundary
    );
    expect(result.decision).toBe('DENY');
    expect(result.failed_check).toBe('field_constraint');
    expect(result.failed_field).toBe('severity');
  });

  it('denies a numeric field outside its range', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:1', params: { amount: 5000 } },
      boundary
    );
    expect(result.decision).toBe('DENY');
    expect(result.failed_field).toBe('amount');
  });

  it('allows a numeric field within range', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:1', params: { amount: 500 } },
      boundary
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('allows unconstrained fields through when not in strict mode', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:1', params: { note: 'anything goes here' } },
      boundary
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('denies unconstrained fields when require_all_params_constrained is set', () => {
    const strictBoundary: CoverageBoundary = { ...boundary, require_all_params_constrained: true };
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer:1', params: { note: 'not covered' } },
      strictBoundary
    );
    expect(result.decision).toBe('DENY');
    expect(result.failed_field).toBe('note');
  });

  it('does not let "*" in resource_id bypass pattern matching (literal match required)', () => {
    const result = checkBoundary(
      { action: 'revoke_api_key', resource_id: 'customer', params: {} },
      boundary
    );
    expect(result.decision).toBe('DENY');
  });
});
