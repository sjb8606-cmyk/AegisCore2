/**
 * Veridact — Integration Tests: Actions & Approvals Routes
 * Engine calls mocked — fast, no live DB required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

vi.mock('../../src/engines/mcpInterceptor', () => ({
  interceptAction: vi.fn(),
  MissingApproverError: class MissingApproverError extends Error {
    statusCode = 400;
  },
}));

vi.mock('../../src/engines/boundaryStore', () => ({
  getBoundary: vi.fn(),
}));

vi.mock('../../src/engines/policyBundleStore', () => ({
  getPolicyBundle: vi.fn(),
}));

vi.mock('../../src/engines/hitlStore', () => ({
  resolveApprovalById: vi.fn(),
  getApproval: vi.fn(),
}));

import { interceptAction } from '../../src/engines/mcpInterceptor';
import { getBoundary } from '../../src/engines/boundaryStore';
import { getPolicyBundle } from '../../src/engines/policyBundleStore';
import { resolveApprovalById, getApproval } from '../../src/engines/hitlStore';

const API_KEY = 'test-api-key-dev';
const TENANT_ID = '00000000-0000-0000-0000-000000000002';
const AUTH_HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'X-Tenant-ID': TENANT_ID,
};

// Suppress the expected MissingApproverError that is intentionally thrown in one test
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message === 'revoke_api_key' || reason?.name === 'MissingApproverError') {
    return;
  }
  throw reason;
});

const app = createApp();

beforeEach(() => {
  process.env.VERIDACT_DEV_API_KEY = API_KEY;
  process.env.VERIDACT_DEV_TENANT_ID = TENANT_ID;
  process.env.NODE_ENV = 'test';
  vi.clearAllMocks();
});

const VALID_HASH = 'a'.repeat(64);

describe('POST /v1/actions/intercept', () => {
  const validBody = {
    action: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
    boundary_id: 'boundary-1',
    rules_version: '1.0.0',
    rules_hash: VALID_HASH,
  };

  it('returns 200 with ALLOWED outcome on a clean pass', async () => {
    vi.mocked(getBoundary).mockResolvedValue({
      boundary_id: 'boundary-1',
      tenant_id: TENANT_ID,
      description: 'test',
      allowed_actions: ['revoke_api_key'],
      allowed_resource_patterns: ['customer:*'],
    });
    vi.mocked(getPolicyBundle).mockResolvedValue({
      rules_version: '1.0.0',
      rules_hash: VALID_HASH,
      default_effect: 'DENY',
      rules: [],
    });
    vi.mocked(interceptAction).mockResolvedValue({
      outcome: 'ALLOWED',
      proposed_action: validBody.action,
      boundary_decision: { decision: 'ALLOW', boundary_id: 'boundary-1', reason: 'ok', failed_check: null },
      policy_decision: {
        decision: 'ALLOW',
        requires_hitl: false,
        matched_rule_id: null,
        reason: 'ok',
        evaluated_rules: [],
      },
      approval_id: null,
      reason: 'ok',
    });

    const res = await request(app).post('/v1/actions/intercept').set(AUTH_HEADERS).send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('ALLOWED');
  });

  it('returns 200 with PENDING_HITL and an approval_id', async () => {
    vi.mocked(getBoundary).mockResolvedValue({
      boundary_id: 'boundary-1',
      tenant_id: TENANT_ID,
      description: 'test',
      allowed_actions: ['revoke_api_key'],
      allowed_resource_patterns: ['customer:*'],
    });
    vi.mocked(getPolicyBundle).mockResolvedValue({
      rules_version: '1.0.0',
      rules_hash: VALID_HASH,
      default_effect: 'DENY',
      rules: [],
    });
    vi.mocked(interceptAction).mockResolvedValue({
      outcome: 'PENDING_HITL',
      proposed_action: validBody.action,
      boundary_decision: { decision: 'ALLOW', boundary_id: 'boundary-1', reason: 'ok', failed_check: null },
      policy_decision: {
        decision: 'ALLOW',
        requires_hitl: true,
        matched_rule_id: 'rule-1',
        reason: 'needs approval',
        evaluated_rules: ['rule-1'],
      },
      approval_id: 'approval-xyz',
      reason: 'needs approval',
    });

    const res = await request(app)
      .post('/v1/actions/intercept')
      .set(AUTH_HEADERS)
      .send({ ...validBody, assigned_approver_id: 'approver-1' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('PENDING_HITL');
    expect(res.body.approval_id).toBe('approval-xyz');
  });

  it('returns 400 for an invalid body (missing action)', async () => {
    const res = await request(app)
      .post('/v1/actions/intercept')
      .set(AUTH_HEADERS)
      .send({ boundary_id: 'boundary-1', rules_version: '1.0.0', rules_hash: VALID_HASH });

    expect(res.status).toBe(400);
  });

  it('returns 401 with no auth', async () => {
    const res = await request(app).post('/v1/actions/intercept').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when interceptAction throws MissingApproverError', async () => {
    vi.mocked(getBoundary).mockResolvedValue({
      boundary_id: 'boundary-1',
      tenant_id: TENANT_ID,
      description: 'test',
      allowed_actions: ['revoke_api_key'],
      allowed_resource_patterns: ['customer:*'],
    });
    vi.mocked(getPolicyBundle).mockResolvedValue({
      rules_version: '1.0.0',
      rules_hash: VALID_HASH,
      default_effect: 'DENY',
      rules: [],
    });
    const { MissingApproverError } = await import('../../src/engines/mcpInterceptor');
    vi.mocked(interceptAction).mockRejectedValue(new MissingApproverError('revoke_api_key'));

    const res = await request(app).post('/v1/actions/intercept').set(AUTH_HEADERS).send(validBody);
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/approvals/:id/resolve', () => {
  it('returns 200 with the resolved approval', async () => {
    vi.mocked(resolveApprovalById).mockResolvedValue({
      approval_id: 'approval-1',
      tenant_id: TENANT_ID,
      proposed_action: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assigned_approver_id: 'approver-1',
      reason: 'test',
      created_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      status: 'APPROVED',
      resolved_at: new Date().toISOString(),
      resolved_by: 'approver-1',
    });

    const res = await request(app)
      .post('/v1/approvals/approval-1/resolve')
      .set(AUTH_HEADERS)
      .send({ resolver_id: 'approver-1', decision: 'APPROVED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('returns 400 for an invalid decision value', async () => {
    const res = await request(app)
      .post('/v1/approvals/approval-1/resolve')
      .set(AUTH_HEADERS)
      .send({ resolver_id: 'approver-1', decision: 'MAYBE' });

    expect(res.status).toBe(400);
  });
});

describe('GET /v1/approvals/:id', () => {
  it('returns 200 with the approval', async () => {
    vi.mocked(getApproval).mockResolvedValue({
      approval_id: 'approval-1',
      tenant_id: TENANT_ID,
      proposed_action: { action: 'revoke_api_key', resource_id: 'customer:1', params: {} },
      assigned_approver_id: 'approver-1',
      reason: 'test',
      created_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      status: 'PENDING',
    });

    const res = await request(app).get('/v1/approvals/approval-1').set(AUTH_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
  });

  it('returns 401 with no auth', async () => {
    const res = await request(app).get('/v1/approvals/approval-1');
    expect(res.status).toBe(401);
  });
});
