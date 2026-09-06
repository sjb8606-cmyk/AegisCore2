import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSyncMock = vi.fn();
  const readFileSyncMock = vi.fn();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    default: { ...actual, existsSync: existsSyncMock, readFileSync: readFileSyncMock },
  };
});

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

// @platform/utils (AppError/ErrorCode/parseUserId) is real -- pure, side-effect-free.

import { withTenantQuery } from '@platform/tenancy';
import { ErrorCode } from '@platform/utils';
import { enrollMember, createReward, awardPoints, redeemReward, generateNanoId } from '../index';

const mockedWithTenantQuery = withTenantQuery as unknown as ReturnType<typeof vi.fn>;

const tenantId = '11111111-1111-1111-1111-111111111111';
const memberId = '22222222-2222-2222-2222-222222222222';
const rewardId = '33333333-3333-3333-3333-333333333333';

const DEFAULT_CONFIG = {
  enabled: true,
  tiers: { rewardCatalog: true },
  limits: { memberCount: 5000, pointExpiryDays: 365 },
};

function mockConfig(cfg: unknown) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('function signatures (GAP documentation)', () => {
  it('GAP: no exported function accepts an actor/admin id -- parseUserId is imported but never called', () => {
    // Real fix: accept and validate (via parseUserId) an actor id on
    // createReward/awardPoints/redeemReward, and persist it for audit
    // purposes (e.g. created_by / awarded_by / redeemed_by columns).
    // Function arity (.length counts only required, non-default params)
    // proves none of these take an actor id today.
    expect(enrollMember.length).toBe(2);   // (tenantId, data)
    expect(createReward.length).toBe(2);   // (tenantId, data)
    expect(awardPoints.length).toBe(4);    // (tenantId, memberId, points, description)
    expect(redeemReward.length).toBe(3);   // (tenantId, memberId, rewardId)
  });
});

describe('generateNanoId', () => {
  it('LIMITATION: produces codes from Math.random(), not a CSPRNG -- guessable, despite being tied to real rewards', () => {
    const id = generateNanoId(8);
    expect(id).toMatch(/^[0-9A-Z]{8}$/);
    // Real fix: use crypto.randomBytes/randomUUID (or nanoid's actual
    // CSPRNG-backed implementation) for any code with monetary value,
    // instead of Math.random().
  });
});

describe('enrollMember', () => {
  it('enrolls a member with a generated referral code', async () => {
    mockConfig(DEFAULT_CONFIG);
    const insertedRow = { id: memberId, tenant_id: tenantId, email: 'a@b.test' };
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ count: '100' }])
      .mockResolvedValueOnce([insertedRow]);

    const result = await enrollMember(tenantId, { email: 'a@b.test' });

    expect(result).toEqual(insertedRow);
    const [, params] = mockedWithTenantQuery.mock.calls[1];
    expect(params[3]).toBeNull(); // name default
    expect(params[4]).toMatch(/^[0-9A-Z]{8}$/); // referral_code
  });

  it('throws FORBIDDEN when the member count limit is reached', async () => {
    mockConfig({ ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, memberCount: 5 } });
    mockedWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);

    await expect(enrollMember(tenantId, { email: 'a@b.test' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Member limits reached for current tier',
    });
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN when Loyalty features are disabled, without querying anything', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    await expect(enrollMember(tenantId, { email: 'a@b.test' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Loyalty features are disabled',
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });
});

describe('createReward', () => {
  it('creates a reward with documented defaults and a hardcoded is_active=true', async () => {
    const insertedRow = { id: rewardId, name: 'Free Coffee', is_active: true };
    mockedWithTenantQuery.mockResolvedValueOnce([insertedRow]);

    const result = await createReward(tenantId, { name: 'Free Coffee', points_cost: 200 });

    expect(result).toEqual(insertedRow);
    const [sql, params] = mockedWithTenantQuery.mock.calls[0];
    expect(params[3]).toBeNull();       // description default
    expect(params[5]).toBe('discount'); // type default
    expect(params[6]).toBeNull();       // stock default
    expect(sql).toContain('true)');     // is_active hardcoded in the SQL literal
  });

  it('BUG: never checks cfg.enabled -- rewards can still be created while Loyalty is globally disabled', async () => {
    mockConfig({ ...DEFAULT_CONFIG, enabled: false });
    mockedWithTenantQuery.mockResolvedValueOnce([{ id: rewardId }]);

    // Real fix: load config here too and check cfg.enabled, consistent
    // with enrollMember/awardPoints.
    await expect(createReward(tenantId, { name: 'X', points_cost: 100 })).resolves.toEqual({ id: rewardId });
  });
});

describe('awardPoints', () => {
  it('adds points to the member balance and records the transaction', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '100' }]) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([{ id: 'tx-1', balance_after: 150 }]) // INSERT points_transactions
      .mockResolvedValueOnce([]); // UPDATE loyalty_members

    const result = await awardPoints(tenantId, memberId, 50, 'Birthday bonus');

    expect(result).toEqual({ id: 'tx-1', balance_after: 150 });
    const txParams = mockedWithTenantQuery.mock.calls[1][1];
    expect(txParams).toEqual([expect.any(String), tenantId, memberId, 50, 150, 'Birthday bonus', 365]);
    const updateParams = mockedWithTenantQuery.mock.calls[2][1];
    expect(updateParams).toEqual([150, 50, memberId, tenantId]);
  });

  it('rejects non-positive points with BAD_REQUEST before touching the database', async () => {
    await expect(awardPoints(tenantId, memberId, 0, 'Oops')).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
      message: 'Awarded points value must be positive',
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the member does not exist', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery.mockResolvedValueOnce([]);
    await expect(awardPoints(tenantId, memberId, 10, 'X')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Member not found',
    });
  });

  it('BUG: the "atomic row lock" is fake -- three separate independent withTenantQuery calls, not one transaction', async () => {
    // Same root cause as legal/depositTrust: withTenantQuery commits each
    // call as its own transaction, so the FOR UPDATE lock from the first
    // call is released long before the balance UPDATE in the third call
    // runs. Two concurrent awardPoints calls for the same member can
    // still race and lose an update. Real fix: use withTenantTransaction
    // directly and pass one client through all three statements.
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '0' }])
      .mockResolvedValueOnce([{ id: 'tx-2' }])
      .mockResolvedValueOnce([]);

    await awardPoints(tenantId, memberId, 10, 'X');
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(3);
  });
});

describe('redeemReward', () => {
  it('redeems a limited-stock reward, deducting points and decrementing stock', async () => {
    mockConfig(DEFAULT_CONFIG);
    const redemptionRow = { id: 'redeem-1', code: 'REDEEM-ABCDEFGH1234' };
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '500' }])                                    // member SELECT
      .mockResolvedValueOnce([{ points_cost: '200', stock: 5, is_active: true, name: 'Free Coffee' }]) // reward SELECT
      .mockResolvedValueOnce([redemptionRow])  // INSERT reward_redemptions
      .mockResolvedValueOnce([])               // INSERT points_transactions
      .mockResolvedValueOnce([])               // UPDATE loyalty_members
      .mockResolvedValueOnce([]);              // UPDATE rewards stock

    const result = await redeemReward(tenantId, memberId, rewardId);

    expect(result).toEqual(redemptionRow);
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(6);

    const redemptionParams = mockedWithTenantQuery.mock.calls[2][1];
    expect(redemptionParams[4]).toBe(200); // pointsCost
    expect(redemptionParams[5]).toMatch(/^REDEEM-[0-9A-Z]{12}$/);

    const balanceUpdateParams = mockedWithTenantQuery.mock.calls[4][1];
    expect(balanceUpdateParams[0]).toBe(300); // 500 - 200
  });

  it('skips the stock decrement for unlimited-stock rewards (stock === null)', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '500' }])
      .mockResolvedValueOnce([{ points_cost: '200', stock: null, is_active: true, name: 'Digital Badge' }])
      .mockResolvedValueOnce([{ id: 'redeem-2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await redeemReward(tenantId, memberId, rewardId);
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(5); // no stock UPDATE call
  });

  it('BUG: the "double row locks" claim is fake -- six independent transactions, not one atomic redeem', async () => {
    // Same underlying issue as awardPoints/depositTrust: every step here
    // (2 SELECT ... FOR UPDATE + 4 writes) is its own committed
    // transaction. If any later step throws, earlier steps have already
    // committed -- e.g. points could be deducted and the redemption
    // recorded, but the stock decrement could fail, leaving stock wrong.
    // Real fix: wrap the whole flow in one withTenantTransaction.
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '500' }])
      .mockResolvedValueOnce([{ points_cost: '200', stock: 5, is_active: true, name: 'Free Coffee' }])
      .mockResolvedValueOnce([{ id: 'redeem-3' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await redeemReward(tenantId, memberId, rewardId);
    expect(mockedWithTenantQuery).toHaveBeenCalledTimes(6);
  });

  it('throws FORBIDDEN when the reward catalog tier is disabled, without querying anything', async () => {
    mockConfig({ ...DEFAULT_CONFIG, tiers: { rewardCatalog: false } });
    await expect(redeemReward(tenantId, memberId, rewardId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Reward Catalog disabled',
    });
    expect(mockedWithTenantQuery).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the member does not exist', async () => {
    mockConfig(DEFAULT_CONFIG);
    // redeemReward fetches member AND reward unconditionally before
    // checking either -- both calls must be mocked even though only the
    // member check is what actually fires here.
    mockedWithTenantQuery
      .mockResolvedValueOnce([])  // member SELECT -- empty
      .mockResolvedValueOnce([{ points_cost: '200', stock: 5, is_active: true, name: 'X' }]); // reward SELECT -- must still be mocked

    await expect(redeemReward(tenantId, memberId, rewardId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Member not found',
    });
  });

  it('throws NOT_FOUND when the reward is missing or inactive', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '500' }])
      .mockResolvedValueOnce([{ points_cost: '200', stock: 5, is_active: false, name: 'X' }]);

    await expect(redeemReward(tenantId, memberId, rewardId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Reward not active or not found',
    });
  });

  it('throws FORBIDDEN when the reward is out of stock', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '500' }])
      .mockResolvedValueOnce([{ points_cost: '200', stock: 0, is_active: true, name: 'X' }]);

    await expect(redeemReward(tenantId, memberId, rewardId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Reward is out of stock',
    });
  });

  it('throws FORBIDDEN when the member has insufficient points', async () => {
    mockConfig(DEFAULT_CONFIG);
    mockedWithTenantQuery
      .mockResolvedValueOnce([{ points_balance: '50' }])
      .mockResolvedValueOnce([{ points_cost: '200', stock: 5, is_active: true, name: 'X' }]);

    await expect(redeemReward(tenantId, memberId, rewardId)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Insufficient points balance for this redemption',
    });
  });
});
