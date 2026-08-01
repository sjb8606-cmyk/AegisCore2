import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: vi.fn(),
}));
vi.mock('../../../utils/src/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/src/index')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

import { trackEvent, getFunnel, ErrorCode } from '../index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { recordUsage } from '../../../metering/src/index';
import { loadConfig } from '../../../utils/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, tiers: { funnels: true } });
});

describe('trackEvent', () => {
  it('persists a real event and meters usage', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: 'event-1', event_name: 'page_view' }]);

    const result = await trackEvent(TENANT_ID, 'page_view', { path: '/home' });

    expect(result.id).toBe('event-1');
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, idempotencyKey: 'analytics:event-1' })
    );
  });
});

describe('getFunnel', () => {
  it('throws FORBIDDEN when the funnels tier is disabled', async () => {
    (loadConfig as any).mockReturnValue({ enabled: true, tiers: { funnels: false } });

    await expect(getFunnel(TENANT_ID, ['step1', 'step2'])).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('throws BAD_REQUEST for an empty steps array', async () => {
    await expect(getFunnel(TENANT_ID, [])).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it('computes real conversion rates from real grouped event counts', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { event_name: 'viewed_page', count: 100 },
      { event_name: 'clicked_button', count: 60 },
      { event_name: 'completed_signup', count: 15 },
    ]);

    const result = await getFunnel(TENANT_ID, ['viewed_page', 'clicked_button', 'completed_signup']);

    expect(result.steps[0]).toEqual({ step: 'viewed_page', count: 100, conversionRate: '100%' });
    expect(result.steps[1]).toEqual({ step: 'clicked_button', count: 60, conversionRate: '60%' });
    expect(result.steps[2]).toEqual({ step: 'completed_signup', count: 15, conversionRate: '15%' });

    expect(withTenantQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM analytics_events'),
      [TENANT_ID, ['viewed_page', 'clicked_button', 'completed_signup']],
      TENANT_ID
    );
  });

  it('reports a real zero count for a step with no matching events, rather than a fake fallback number', async () => {
    (withTenantQuery as any).mockResolvedValue([
      { event_name: 'viewed_page', count: 50 },
    ]);

    const result = await getFunnel(TENANT_ID, ['viewed_page', 'never_happened']);

    expect(result.steps[1]).toEqual({ step: 'never_happened', count: 0, conversionRate: '0%' });
  });
});

describe('regression guard — old fabricated formula is gone from the source', () => {
  it('the source file no longer contains the old (100 - i*20) fake formula', () => {
    const sourcePath = path.resolve(__dirname, '../index.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('100 - i * 20');
    expect(source).not.toContain('Simulated High-Speed Funnel');
  });
});
