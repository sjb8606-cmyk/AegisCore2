import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStubRealtimeEngine,
  loadConfig,
  RealtimeSyncError,
  type RealtimeSyncEngine,
} from '../index';

const T = '11111111-1111-1111-1111-111111111111';
const ROOM = '55555555-5555-4555-8555-555555555555';
const U1 = '22222222-2222-2222-2222-222222222222';
const U2 = '33333333-3333-4333-8333-333333333333';

describe('realtime-sync stub', () => {
  let engine: RealtimeSyncEngine;

  beforeEach(() => {
    engine = createStubRealtimeEngine();
  });

  it('config is stubMode with crdtMerge false', () => {
    const cfg = loadConfig();
    expect(cfg.stubMode).toBe(true);
    expect(cfg.tiers.crdtMerge).toBe(false);
  });

  it('presence join and list', async () => {
    await engine.joinPresence(T, ROOM, { userId: U1, displayName: 'Ada' });
    await engine.joinPresence(T, ROOM, { userId: U2, displayName: 'Bob' });
    const list = await engine.listPresence(T, ROOM);
    expect(list).toHaveLength(2);
  });

  it('leave presence', async () => {
    await engine.joinPresence(T, ROOM, { userId: U1 });
    await engine.leavePresence(T, ROOM, U1);
    expect(await engine.listPresence(T, ROOM)).toHaveLength(0);
  });

  it('update cursor requires join first', async () => {
    await expect(
      engine.updateCursor(T, ROOM, U1, { blockId: 'b1', offset: 0 }),
    ).rejects.toMatchObject({ code: 'NOT_IN_ROOM' });
  });

  it('appendOp assigns seq and listOps filters', async () => {
    const a = await engine.appendOp({
      tenantId: T,
      roomId: ROOM,
      type: 'block.insert',
      payload: { type: 'paragraph', text: 'hi' },
      actorId: U1,
    });
    const b = await engine.appendOp({
      tenantId: T,
      roomId: ROOM,
      type: 'block.update',
      payload: { blockId: 'x', text: 'yo' },
      actorId: U1,
    });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    const after0 = await engine.listOps(T, ROOM, 0);
    expect(after0).toHaveLength(1);
    expect(after0[0].id).toBe(b.id);
  });

  it('subscribe receives ops', async () => {
    const seen: string[] = [];
    const unsub = engine.subscribe(T, ROOM, (op) => seen.push(op.type));
    await engine.appendOp({
      tenantId: T,
      roomId: ROOM,
      type: 'page.update_title',
      payload: { title: 'New' },
      actorId: U1,
    });
    expect(seen).toEqual(['page.update_title']);
    unsub();
  });

  it('mergeRemoteOps throws NOT_IMPLEMENTED in stub', async () => {
    await expect(engine.mergeRemoteOps(T, ROOM, [])).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      statusCode: 501,
    });
  });
});
