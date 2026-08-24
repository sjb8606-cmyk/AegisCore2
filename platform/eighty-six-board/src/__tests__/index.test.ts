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
      hardBlockOn86: true,
      allowLowWithWarning: true,
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
  mark86,
  markLow,
  clear86,
  assertOrderable,
  getBoard,
  __resetEightySixBoardStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000ff';

describe('eighty-six-board', () => {
  beforeEach(() => {
    __resetEightySixBoardStore();
    vi.clearAllMocks();
  });

  it('blocks order when item is 86\'d', async () => {
    await mark86(tenantId, actorId, {
      menuItemId: itemId,
      reason: 'Out of salmon',
    });
    await expect(assertOrderable(tenantId, itemId)).rejects.toThrow(/86/i);
    const board = await getBoard(tenantId, actorId);
    expect(board.some((e) => e.menuItemId === itemId)).toBe(true);
  });

  it('allows low with warning', async () => {
    await markLow(tenantId, actorId, {
      menuItemId: itemId,
      reason: 'Last 3 portions',
    });
    const result = await assertOrderable(tenantId, itemId);
    expect(result.orderable).toBe(true);
    expect(result.status).toBe('low');
    expect(result.warning).toBeTruthy();
  });

  it('clears 86 back to available', async () => {
    await mark86(tenantId, actorId, { menuItemId: itemId });
    await clear86(tenantId, actorId, itemId);
    const result = await assertOrderable(tenantId, itemId);
    expect(result.orderable).toBe(true);
    expect(result.status).toBe('available');
  });
});
