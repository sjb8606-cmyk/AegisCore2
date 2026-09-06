/**
 * @platform/disaster-recovery
 * LIMITATION: triggerFailover only records a 'triggered' event — no real orchestration.
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
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', INTERNAL: 'INTERNAL', BAD_REQUEST: 'BAD_REQUEST',
  },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('disaster-recovery', () => {
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
      tiers: { failoverOrchestration: true },
      limits: { maxFailoverEventsPerDay: 3, drSimulationFrequencyDays: 180, maxRunbookSteps: 20 },
    }));
    const { DisasterRecoveryService, ErrorCode } = await load();
    await expect(DisasterRecoveryService.triggerFailover(TENANT, { event_type: 'failover' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('rejects invalid event_type via zod', async () => {
    const { DisasterRecoveryService } = await load();
    await expect(DisasterRecoveryService.triggerFailover(TENANT, { event_type: 'explode' }))
      .rejects.toThrow();
  });

  it('inserts triggered event with default region_to', async () => {
    const row = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      event_type: 'failover', status: 'triggered', region_to: 'backup-default',
    };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { DisasterRecoveryService } = await load();
    const result = await DisasterRecoveryService.triggerFailover(TENANT, { event_type: 'failover' });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][1][2]).toBe('backup-default');
  });

  it('uses provided region_to', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', region_to: 'eu-west-1', status: 'triggered' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { DisasterRecoveryService } = await load();
    const result = await DisasterRecoveryService.triggerFailover(TENANT, {
      event_type: 'simulation', region_to: 'eu-west-1',
    });
    expect(result.region_to).toBe('eu-west-1');
  });

  it('fetchEvents returns list', async () => {
    const rows = [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', event_type: 'failback' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { DisasterRecoveryService } = await load();
    expect(await DisasterRecoveryService.fetchEvents(TENANT)).toEqual(rows);
  });
});
