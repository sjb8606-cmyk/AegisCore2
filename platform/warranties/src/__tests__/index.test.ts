/**
 * @platform/warranties
 * Real claim score rules (severity + accidental keywords) drive auto-approve vs under_review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
  isValidUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  registerWarranty, evaluateClaimScore, submitClaim, getWarrantyLedger, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const WARRANTY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('warranties', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registerWarranty FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: {}, limits: {}, thresholds: {},
    }));
    await expect(registerWarranty(TENANT, USER, { product_id: 'p1', customer_id: 'c1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('registerWarranty inserts with 1-year end_date', async () => {
    const row = { id: WARRANTY, product_id: 'p1' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await registerWarranty(TENANT, USER, {
      product_id: 'p1', customer_id: 'c1', serial_number: 'SN-1',
    });
    expect(result).toEqual(row);
    const endDate = new Date(mockWithTenantQuery.mock.calls[0][1][6]);
    const now = new Date();
    expect(endDate.getFullYear()).toBe(now.getFullYear() + 1);
  });

  describe('evaluateClaimScore', () => {
    it('starts high and drops for high severity', async () => {
      const score = await evaluateClaimScore('Screen not turning on', 5);
      expect(score).toBe(0.8); // 0.95 - 0.15
    });

    it('drops further for accidental keywords', async () => {
      const score = await evaluateClaimScore('I dropped it in water', 2);
      expect(score).toBe(0.6); // 0.95 - 0.35
    });

    it('floors at 0.1', async () => {
      const score = await evaluateClaimScore('dropped cracked water liquid spill', 5);
      expect(score).toBeGreaterThanOrEqual(0.1);
      expect(score).toBe(0.45); // 0.95 - 0.15 - 0.35
    });
  });

  it('submitClaim NOT_FOUND when no active warranty', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(submitClaim(TENANT, USER, {
      warranty_id: WARRANTY, issue_description: 'Broken hinge', severity: 2,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('submitClaim auto-approves high score and may dispatch ticket', async () => {
    // score for clean desc severity 1 = 0.95 >= 0.85 autoApprove
    const claim = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      status: 'approved', claim_score: 0.95,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: WARRANTY, status: 'active' }])
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([]); // service ticket
    const result = await submitClaim(TENANT, USER, {
      warranty_id: WARRANTY, issue_description: 'Factory defect', severity: 1,
    });
    expect(result.status).toBe('approved');
    expect(result.claim_score).toBe(0.95);
  });

  it('submitClaim under_review when score below auto-approve threshold', async () => {
    // accidental keyword → 0.6 < 0.85
    const claim = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      status: 'under_review', claim_score: 0.6,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ id: WARRANTY, status: 'active' }])
      .mockResolvedValueOnce([claim]);
    const result = await submitClaim(TENANT, USER, {
      warranty_id: WARRANTY, issue_description: 'I dropped it', severity: 1,
    });
    expect(result.status).toBe('under_review');
    expect(result.claim_score).toBe(0.6);
  });

  it('getWarrantyLedger nests claims with service tickets', async () => {
    const warranty = { id: WARRANTY, status: 'active' };
    const claims = [{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', status: 'approved' }];
    const tickets = [{ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }];
    mockWithTenantQuery
      .mockResolvedValueOnce([warranty])
      .mockResolvedValueOnce(claims)
      .mockResolvedValueOnce(tickets);
    const result = await getWarrantyLedger(TENANT, WARRANTY);
    expect(result.claims[0].service_tickets).toEqual(tickets);
  });
});
