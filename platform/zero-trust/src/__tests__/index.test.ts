/**
 * @platform/zero-trust
 * Real computeTrustScore: unknown=0.1, new=0.3, known decays + continuity + risk penalty.
 * decision: allow if trustScore > 0.7 else step_up.
 * cachedConfig → vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', INTERNAL: 'INTERNAL' },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

describe('zero-trust', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { deviceTrustScoring: true, auditTrail: true },
      limits: { trustEvaluationsPerSecond: 100, maxPolicyRulesPerTenant: 10, sessionRevalidationIntervalSeconds: 300 },
    }));
    const { ZeroTrustService, ErrorCode } = await load();
    await expect(ZeroTrustService.evaluateTrust(TENANT, {
      user_id: USER, device_fingerprint: 'fp-1',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('unknown device (no fingerprint) scores 0.1 and step_up', async () => {
    // existing lookup returns empty; fingerprint becomes 'unknown_device'
    mockWithTenantQuery
      .mockResolvedValueOnce([]) // existing
      .mockResolvedValueOnce([{ trust_score: 0.1 }]) // upsert
      .mockResolvedValueOnce([]); // audit event
    const { ZeroTrustService } = await load();
    const result = await ZeroTrustService.evaluateTrust(TENANT, { user_id: USER });
    expect(result.trustScore).toBe(0.1);
    expect(result.decision).toBe('step_up');
  });

  it('never-seen device with fingerprint scores 0.3 and step_up', async () => {
    mockWithTenantQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ trust_score: 0.3 }])
      .mockResolvedValueOnce([]);
    const { ZeroTrustService } = await load();
    const result = await ZeroTrustService.evaluateTrust(TENANT, {
      user_id: USER, device_fingerprint: 'fp-new',
    });
    expect(result.trustScore).toBe(0.3);
    expect(result.decision).toBe('step_up');
  });

  it('known device: continuity bonus, allow when > 0.7', async () => {
    // existing score 0.8, last_verified now → decay \~0, +0.05 continuity → 0.85
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        trust_score: 0.8,
        last_verified: new Date().toISOString(),
      }])
      .mockResolvedValueOnce([{ trust_score: 0.85 }])
      .mockResolvedValueOnce([]);
    const { ZeroTrustService } = await load();
    const result = await ZeroTrustService.evaluateTrust(TENANT, {
      user_id: USER, device_fingerprint: 'fp-known',
    });
    expect(result.trustScore).toBe(0.85);
    expect(result.decision).toBe('allow');
  });

  it('risk signal impossible_travel penalizes score by 0.3', async () => {
    // 0.8 - 0 decay + 0.05 - 0.3 = 0.55
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        trust_score: 0.8,
        last_verified: new Date().toISOString(),
      }])
      .mockResolvedValueOnce([{ trust_score: 0.55 }])
      .mockResolvedValueOnce([]);
    const { ZeroTrustService } = await load();
    const result = await ZeroTrustService.evaluateTrust(TENANT, {
      user_id: USER,
      device_fingerprint: 'fp-known',
      context: { riskSignal: 'impossible_travel' },
    });
    expect(result.trustScore).toBe(0.55);
    expect(result.decision).toBe('step_up');
  });

  it('getEvents returns ordered list', async () => {
    const rows = [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', event_type: 'zt.trust.evaluated' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { ZeroTrustService } = await load();
    expect(await ZeroTrustService.getEvents(TENANT)).toEqual(rows);
  });
});
