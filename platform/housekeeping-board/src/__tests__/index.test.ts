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
      requireInspectBeforeReady: true,
      priorities: ['normal', 'rush', 'vip'],
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
  registerRoom,
  setRoomStatus,
  assignAttendant,
  markCheckoutDirty,
  listBoard,
  __resetHousekeepingBoardStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const roomId = 'room-101';

describe('housekeeping-board', () => {
  beforeEach(() => {
    __resetHousekeepingBoardStore();
    vi.clearAllMocks();
  });

  it('registers room and marks dirty on checkout', async () => {
    await registerRoom(tenantId, actorId, {
      roomId,
      roomLabel: '101',
    });
    const dirty = await markCheckoutDirty(tenantId, actorId, roomId);
    expect(dirty.status).toBe('dirty');
  });

  it('assigns attendant and requires inspect before ready', async () => {
    await registerRoom(tenantId, actorId, {
      roomId,
      roomLabel: '101',
      status: 'dirty',
    });
    const assigned = await assignAttendant(
      tenantId,
      actorId,
      roomId,
      'hk-1',
      'rush',
    );
    expect(assigned.status).toBe('in_progress');
    expect(assigned.priority).toBe('rush');
    await setRoomStatus(tenantId, actorId, roomId, 'clean');
    await expect(
      setRoomStatus(tenantId, actorId, roomId, 'ready'),
    ).rejects.toThrow(/inspect/i);
    await setRoomStatus(tenantId, actorId, roomId, 'inspect');
    const ready = await setRoomStatus(tenantId, actorId, roomId, 'ready');
    expect(ready.status).toBe('ready');
  });

  it('lists board prioritized', async () => {
    await registerRoom(tenantId, actorId, {
      roomId: 'r1',
      roomLabel: '101',
      status: 'dirty',
    });
    await registerRoom(tenantId, actorId, {
      roomId: 'r2',
      roomLabel: '102',
      status: 'dirty',
      priority: 'vip',
    });
    const board = await listBoard(tenantId, actorId, { status: 'dirty' });
    expect(board[0].priority).toBe('vip');
  });
});
