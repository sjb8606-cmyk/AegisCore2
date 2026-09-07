/**
 * @platform/threat-detection
 * Server-side risk score (velocity + optional geo-velocity + 0.2 * client
 * score, client score capped at 1 by ThreatEventSchema); alerts at >= 0.75.
 * cachedConfig → vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../../utils/src/index', () => ({
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

  it('rejects a risk_score above the schema max of 1 (real validation, not folded)', async () => {
    // ThreatEventSchema caps risk_score at max(1) — a caller can never push
    // a raw score above 1 through validation; the server-side fold
    // (score * 0.2) is what keeps it from being authoritative, not the cap.
    const { ThreatDetectionService } = await load();
    await expect(ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'login_failure',
      risk_score: 1.5,
    })).rejects.toThrow();
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
    expect(mockWithTenantQuery.mock.calls.filter((c) => /threat_alerts/i.test(String(c[0])))).toHaveLength(0);
  });

  it('fires a "high" alert via velocity + geo-velocity (client risk_score alone can never reach 0.75)', async () => {
    // With risk_score capped at 1 by the schema, velocity(max 0.5) +
    // client(max 1*0.2=0.2) tops out at 0.7 — it can NEVER reach the 0.75
    // alert threshold on its own. Only geoVelocityDetection's +0.4 can
    // close that gap. velocity count=8 -> +0.4, geo triggered -> +0.4 = 0.8.
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { geoVelocityDetection: true },
      limits: {},
    }));
    const inserted = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      event_type: 'brute_force',
      risk_score: 0.8,
    };
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: 8 }])                                                   // velocity -> +0.4
      .mockResolvedValueOnce([{ geo_location: 'Toronto', created_at: new Date(Date.now() - 5 * 60000).toISOString() }]) // geo lookup -> different city, recent -> +0.4
      .mockResolvedValueOnce([inserted])                                                        // insert event
      .mockResolvedValueOnce([]);                                                                // alert insert
    const { ThreatDetectionService } = await load();
    const result = await ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'brute_force',
      ip_address: '203.0.113.10',
      geo_location: 'New York',
    });
    expect(result.risk_score).toBe(0.8);
    const alertCall = mockWithTenantQuery.mock.calls.find((c) => /threat_alerts/i.test(String(c[0])));
    expect(alertCall).toBeTruthy();
    expect(alertCall![1][1]).toBe('high'); // 0.8 < 0.9 -> high not critical
  });

  it('severity critical when velocity + geo-velocity reach >= 0.9', async () => {
    // velocity count=10+ -> capped at +0.5, geo triggered -> +0.4 = 0.9 exactly.
    const inserted = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      event_type: 'account_takeover',
      risk_score: 0.9,
    };
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { geoVelocityDetection: true },
      limits: {},
    }));
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: 20 }])
      .mockResolvedValueOnce([{ geo_location: 'Toronto', created_at: new Date(Date.now() - 5 * 60000).toISOString() }])
      .mockResolvedValueOnce([inserted])
      .mockResolvedValueOnce([]);
    const { ThreatDetectionService } = await load();
    await ThreatDetectionService.ingestThreatEvent(TENANT, {
      event_type: 'account_takeover',
      ip_address: '203.0.113.10',
      geo_location: 'New York',
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
