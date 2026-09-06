/**
 * @platform/threat-detection
 * Server-side risk score (velocity + optional geo + 0.2 * client score); alerts at >= 0.75.
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
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', INTERNAL: 'INTERNAL' },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('threat-detection', () => {
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
      tiers: { anomalyDetection: true },
      limits: { eventsPerSecond: 100, maxBaselineWindowDays: 30, alertRetentionDays: 90 },
    }));
    const { ThreatDetectionService, ErrorCode } = await load();
    await expect(ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'login_failure',
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('ingests event with velocity-based score and no alert below 0.75', async () => {
    // velocity count query → 2 events → score += min(0.5, 2/20) = 0.1
    // no client risk_score → final 0.1
    const inserted = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      event_type: 'login_failure',
      risk_score: 0.1,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: 2 }])  // velocity
      .mockResolvedValueOnce([inserted]);     // insert event
    const { ThreatDetectionService } = await load();
    const result = await ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'login_failure',
      ip_address: '203.0.113.10',
    });
    expect(result.risk_score).toBe(0.1);
    // no alert insert
    expect(mockWithTenantQuery.mock.calls.filter((c) => /threat_alerts/i.test(String(c[0])))).toHaveLength(0);
  });

  it('folds client risk_score * 0.2 and fires alert at >= 0.75', async () => {
    // velocity 0 + client 1.0 * 0.2 = 0.2 — need higher
    // velocity 20 → min(0.5, 20/20)=0.5 + 1.0*0.2 = 0.7 still under
    // velocity 20 + client 1.5 clamped: score min(1, 0.5+0.3)=0.8
    const inserted = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      event_type: 'brute_force',
      risk_score: 0.8,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: 20 }]) // velocity → +0.5
      .mockResolvedValueOnce([inserted])      // insert event
      .mockResolvedValueOnce([]);             // alert insert
    const { ThreatDetectionService } = await load();
    const result = await ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'brute_force',
      ip_address: '203.0.113.10',
      risk_score: 1.5, // *0.2 = 0.3 → total 0.8
    });
    expect(result.risk_score).toBe(0.8);
    const alertCall = mockWithTenantQuery.mock.calls.find((c) => /threat_alerts/i.test(String(c[0])));
    expect(alertCall).toBeTruthy();
    expect(alertCall![1][1]).toBe('high'); // 0.8 < 0.9 → high not critical
  });

  it('severity critical when score >= 0.9', async () => {
    // velocity 0.5 + client risk 3 * 0.2 = 0.6 → 1.1 clamped to 1.0
    const inserted = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      event_type: 'account_takeover',
      risk_score: 1,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: 20 }])
      .mockResolvedValueOnce([inserted])
      .mockResolvedValueOnce([]);
    const { ThreatDetectionService } = await load();
    await ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'account_takeover',
      ip_address: '203.0.113.10',
      risk_score: 3,
    });
    const alertCall = mockWithTenantQuery.mock.calls.find((c) => /threat_alerts/i.test(String(c[0])));
    expect(alertCall![1][1]).toBe('critical');
  });

  it('fetchEvents returns ordered list', async () => {
    const rows = [{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', event_type: 'login_failure', risk_score: 0.2 }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { ThreatDetectionService } = await load();
    expect(await ThreatDetectionService.fetchEvents(TENANT)).toEqual(rows);
  });
});
