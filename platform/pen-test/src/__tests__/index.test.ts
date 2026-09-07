/**
 * @platform/pen-test
 * LIMITATION: only scan_type === 'dependency' is implemented; app/infra/full fail honestly with NOT_IMPLEMENTED.
 * GAP: many tiers (attackSurfaceMapping, penetrationSimulation, …) exist in schema but have no implementation path.
 * Uses module-level cachedConfig → vi.resetModules() + dynamic import per cache-sensitive test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockScanDirectory = vi.fn();

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));
vi.mock('../../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND',
    INTERNAL: 'INTERNAL', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  },
}));
const mockBotConstructor = vi.fn();
vi.mock('../../../aegis-swarm/src/bots/dependency-vuln-scanner', () => ({
  DependencyVulnScannerBot: (...args: unknown[]) => mockBotConstructor(...args),
}));
vi.mock('../../../bot-runtime/src/types', () => ({}));

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('pen-test', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    // resetAllMocks() wipes the constructor mock's implementation too —
    // nothing else re-arms it per test, so it must be re-armed here.
    mockBotConstructor.mockImplementation(() => ({
      scanDirectory: (...args: unknown[]) => mockScanDirectory(...args),
    }));
  });

  async function load() {
    return import('../index');
  }

  it('FORBIDDEN when suite globally disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { vulnerabilityScanning: true, dependencyScanning: true },
      limits: { scansPerDay: 5, maxAssetsPerScan: 50, reportRetentionDays: 30 },
    }));
    const { PenTestService, ErrorCode } = await load();
    await expect(PenTestService.runSecurityScan(TENANT, { scan_type: 'dependency' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/disabled/i) });
  });

  it('NOT_IMPLEMENTED for non-dependency scan types (LIMITATION – honest failure)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'running' }]);
    mockWithTenantQuery.mockResolvedValueOnce([]); // failed update
    const { PenTestService, ErrorCode } = await load();
    await expect(PenTestService.runSecurityScan(TENANT, { scan_type: 'app' }))
      .rejects.toMatchObject({
        code: ErrorCode.NOT_IMPLEMENTED,
        message: expect.stringMatching(/not yet implemented/i),
      });
  });

  it('runs dependency scan, writes findings, scores, and completes', async () => {
    const scanId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    mockScanDirectory.mockResolvedValue({
      findings: [
        { sev: 'info', desc: 'Low severity advisory', loc: 'pkg-a@1.0.0' },
        { sev: 'warn', desc: 'Medium severity advisory', loc: 'pkg-b@2.0.0' },
      ],
    });

    mockWithTenantQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO security_scans')) return [{ id: scanId, status: 'running' }];
      if (sql.includes('INSERT INTO security_findings')) return [];
      if (sql.includes('UPDATE security_scans') && sql.includes('completed')) {
        return [{ id: scanId, status: 'completed', score: 94, findings_count: 2 }];
      }
      return [];
    });

    const { PenTestService } = await load();
    const result = await PenTestService.runSecurityScan(TENANT, {
      scan_type: 'dependency',
      target_assets: ['/tmp/project'],
    });
    expect(result.status).toBe('completed');
    expect(result.score).toBe(94); // 100 - (1 + 5)
    expect(result.findings_count).toBe(2);
    expect(mockScanDirectory).toHaveBeenCalledWith('/tmp/project');
  });

  it('marks scan failed and throws INTERNAL when bot.scanDirectory throws', async () => {
    const scanId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    mockWithTenantQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO security_scans')) return [{ id: scanId, status: 'running' }];
      if (sql.includes("status = 'failed'")) return [];
      return [];
    });
    mockScanDirectory.mockRejectedValue(new Error('npm audit blew up'));

    const { PenTestService, ErrorCode } = await load();
    await expect(PenTestService.runSecurityScan(TENANT, { scan_type: 'dependency' }))
      .rejects.toMatchObject({ code: ErrorCode.INTERNAL, message: expect.stringMatching(/Dependency scan failed/i) });
  });

  it('fetchScans returns ordered list from withTenantQuery', async () => {
    const rows = [{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', scan_type: 'dependency', status: 'completed' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { PenTestService } = await load();
    const result = await PenTestService.fetchScans(TENANT);
    expect(result).toEqual(rows);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/FROM security_scans/i);
  });
});
