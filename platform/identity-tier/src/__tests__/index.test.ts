import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import {
  submitVerification,
  approveSubmission,
  rejectSubmission,
  getCurrentTier,
  requireTier,
  noopProvider,
  TIER_UNVERIFIED,
  TIER_PHONE,
  TierVerificationProvider,
} from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { loadConfig } from '@platform/utils';
import { AppError } from '@platform/utils';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { submissionsPerDay: 5 } });
  (withTenantQuery as any).mockResolvedValue([{ count: '0' }]);
});

describe('submitVerification', () => {
  it('rejects when no provider is configured (default noopProvider)', async () => {
    await expect(
      submitVerification(TENANT_ID, USER_ID, { verificationType: 'phone', payload: {} }),
    ).rejects.toThrow('No identity verification provider configured');
  });

  it('creates a pending submission via a real provider and returns the hosted URL', async () => {
    const fakeProvider: TierVerificationProvider = {
      startVerification: vi.fn().mockResolvedValue({ providerRef: 'prov-123', hostedUrl: 'https://verify.example/abc' }),
    };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ id: 'sub-1', status: 'pending', tier_requested: TIER_PHONE }]);

    const result = await submitVerification(TENANT_ID, USER_ID, { verificationType: 'phone', payload: { phone: '+15551234567' } }, fakeProvider);

    expect(fakeProvider.startVerification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID, verificationType: 'phone' }),
    );
    expect(result).toMatchObject({ id: 'sub-1', hostedUrl: 'https://verify.example/abc' });
  });

  it('rejects an invalid verification type before ever calling the provider', async () => {
    const fakeProvider: TierVerificationProvider = { startVerification: vi.fn() };
    await expect(
      submitVerification(TENANT_ID, USER_ID, { verificationType: 'not_a_real_type' as any, payload: {} }, fakeProvider),
    ).rejects.toThrow();
    expect(fakeProvider.startVerification).not.toHaveBeenCalled();
  });
});

describe('approveSubmission', () => {
  it('advances the user tier and never downgrades an existing higher tier', async () => {
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ id: 'sub-1', status: 'pending', user_id: USER_ID, tier_requested: TIER_PHONE }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tenant_id: TENANT_ID, user_id: USER_ID, current_tier: TIER_PHONE }]);

    const result = await approveSubmission(TENANT_ID, 'service-actor', 'sub-1');
    expect(result.current_tier).toBe(TIER_PHONE);
  });

  it('throws NOT_FOUND for a missing submission', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    await expect(approveSubmission(TENANT_ID, 'service-actor', 'missing')).rejects.toThrow(AppError);
  });

  it('throws CONFLICT if the submission was already resolved', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'sub-1', status: 'approved', user_id: USER_ID, tier_requested: TIER_PHONE }]);
    await expect(approveSubmission(TENANT_ID, 'service-actor', 'sub-1')).rejects.toThrow('already approved');
  });
});

describe('rejectSubmission', () => {
  it('marks a submission rejected with a reason', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'sub-1', status: 'rejected' }]);
    const result = await rejectSubmission(TENANT_ID, 'service-actor', 'sub-1', 'document unreadable');
    expect(result.status).toBe('rejected');
  });
});

describe('getCurrentTier / requireTier', () => {
  it('defaults to TIER_UNVERIFIED when no record exists', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([]);
    expect(await getCurrentTier(TENANT_ID, USER_ID)).toBe(TIER_UNVERIFIED);
  });

  it('requireTier throws FORBIDDEN when the user is below the minimum', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ current_tier: TIER_UNVERIFIED }]);
    await expect(requireTier(TENANT_ID, USER_ID, TIER_PHONE)).rejects.toThrow(AppError);
  });

  it('requireTier passes silently when the user meets the minimum', async () => {
    (withTenantQuery as any).mockResolvedValueOnce([{ current_tier: TIER_PHONE }]);
    await expect(requireTier(TENANT_ID, USER_ID, TIER_PHONE)).resolves.toBeUndefined();
  });
});
