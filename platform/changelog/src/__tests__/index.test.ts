import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/src/index', () => ({
  loadConfig: vi.fn(),
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN' },
}));
vi.mock('../../../tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { getTimeline } from '../index';
import { loadConfig } from '../../../utils/src/index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { recordUsage } from '../../../metering/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_ID_A = '22222222-2222-2222-2222-222222222222';
const ENTITY_ID_B = '33333333-3333-3333-3333-333333333333';

const enabledConfig = {
  enabled: true,
  tiers: { fieldLevelHighlighting: true, plainLanguageSummary: false },
  limits: { maxEntriesPerPage: 20 },
};

beforeEach(() => {
  vi.resetAllMocks();
  (loadConfig as any).mockReturnValue(enabledConfig);
  (withTenantQuery as any).mockResolvedValue([]);
});

describe('getTimeline', () => {
  it('blocks when the timeline feature is disabled', async () => {
    (loadConfig as any).mockReturnValue({ ...enabledConfig, enabled: false });
    await expect(getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A)).rejects.toThrow('Timeline disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('hides diff detail when fieldLevelHighlighting tier is off', async () => {
    (loadConfig as any).mockReturnValue({ ...enabledConfig, tiers: { fieldLevelHighlighting: false } });
    const timeline = await getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A);
    expect(timeline[0].detail).toBe('Hidden');
  });

  it('shows from/to detail when fieldLevelHighlighting tier is on', async () => {
    const timeline = await getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A);
    expect(timeline[0].detail).toContain('From "pending" to "active"');
  });

  it('records a metered view event', async () => {
    await getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, eventType: 'api_call' })
    );
  });

  // KNOWN DEFECT — documented, confirmed by the source's own comment
  // ("Simulate fetching Diffs (In production, this queries the Diff Engine)").
  // entityType/entityId are accepted as parameters but never used to fetch
  // anything. Two completely different entities produce byte-identical
  // "history."
  it('DEFECT: returns identical hardcoded diffs regardless of entityType/entityId', async () => {
    const timelineA = await getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A);
    const timelineB = await getTimeline(TENANT_ID, 'invoice', ENTITY_ID_B);

    expect(timelineA).toEqual(timelineB);
    expect(timelineA).toHaveLength(2);
    expect(timelineA[0].label).toBe('Changed status');
    // TODO(changelog launch blocker): actually query the Diff Engine keyed on entityType/entityId.
  });

  // BUG — documented, not hidden.
  // The audit-log insert hardcodes actor_id to the literal string 'founder'
  // on every call, regardless of who is actually viewing the timeline. The
  // audit trail this produces is false: it will attribute every view, by
  // every user, to 'founder'.
  it('BUG: always records the view as performed by the literal actor "founder"', async () => {
    await getTimeline(TENANT_ID, 'ticket', ENTITY_ID_A);
    const insertParams = (withTenantQuery as any).mock.calls[0][1];
    expect(insertParams[3]).toBe('founder');
    // TODO(changelog bug): getTimeline() needs a userId/actor parameter instead of a hardcoded literal.
  });
});
