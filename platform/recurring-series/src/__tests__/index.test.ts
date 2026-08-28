import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      maxOccurrences: 52,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  createSeries,
  cancelOccurrence,
  cancelSeries,
  listOccurrences,
  __resetRecurringSeriesStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('recurring-series', () => {
  beforeEach(() => {
    __resetRecurringSeriesStore();
    vi.clearAllMocks();
  });

  it('materializes weekly occurrences', async () => {
    const { series, occurrences: occs } = await createSeries(
      tenantId,
      actorId,
      {
        title: 'Weekly standup',
        frequency: 'weekly',
        startAt: '2026-10-06T15:00:00Z',
        durationMinutes: 30,
        count: 4,
      },
    );
    expect(series.status).toBe('active');
    expect(occs).toHaveLength(4);
    const list = await listOccurrences(tenantId, actorId, series.id);
    expect(list.every((o) => o.status === 'scheduled')).toBe(true);
  });

  it('cancels a single occurrence', async () => {
    const { series, occurrences: occs } = await createSeries(
      tenantId,
      actorId,
      {
        title: 'Class',
        frequency: 'weekly',
        startAt: '2026-11-01T10:00:00Z',
        durationMinutes: 60,
        count: 3,
      },
    );
    const cancelled = await cancelOccurrence(tenantId, actorId, occs[1].id);
    expect(cancelled.status).toBe('cancelled');
    const list = await listOccurrences(tenantId, actorId, series.id);
    expect(list.filter((o) => o.status === 'scheduled')).toHaveLength(2);
  });

  it('cancels entire series', async () => {
    const { series } = await createSeries(tenantId, actorId, {
      title: 'Biweekly review',
      frequency: 'biweekly',
      startAt: '2026-09-01T12:00:00Z',
      durationMinutes: 45,
      count: 3,
    });
    const cancelled = await cancelSeries(tenantId, actorId, series.id);
    expect(cancelled.status).toBe('cancelled');
    const list = await listOccurrences(tenantId, actorId, series.id);
    expect(list.every((o) => o.status === 'cancelled')).toBe(true);
  });
});
