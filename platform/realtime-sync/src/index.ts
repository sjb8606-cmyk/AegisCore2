/**
 * @platform/realtime-sync
 *
 * STUB ONLY — interface + single-process bus.
 * Real multiplayer requires a CRDT (e.g. Yjs) + WebSocket transport.
 * Do not claim collab is production-ready until crdtMerge tier is real.
 */
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  stubMode: z.boolean(),
  tiers: z.object({
    presence: z.boolean(),
    opLog: z.boolean(),
    crdtMerge: z.boolean(),
  }),
  limits: z.object({
    maxPresencePerRoom: z.number().int().positive(),
    maxOpsRetained: z.number().int().positive(),
  }),
});

export type RealtimeSyncConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: RealtimeSyncConfig = {
  enabled: true,
  stubMode: true,
  tiers: { presence: true, opLog: true, crdtMerge: false },
  limits: { maxPresencePerRoom: 50, maxOpsRetained: 1000 },
};

export function loadConfig(): RealtimeSyncConfig {
  const p = path.join(process.cwd(), 'config', 'realtime-sync.json');
  try {
    if (fs.existsSync(p)) return ConfigSchema.parse(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) {
    console.warn('[realtime-sync] config load failed:', e);
  }
  return DEFAULT_CONFIG;
}

export class RealtimeSyncError extends Error {
  constructor(
    message: string,
    public code: string = 'REALTIME_ERROR',
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'RealtimeSyncError';
  }
}

/** Ops aligned with block-store mutations */
export const OpTypeSchema = z.enum([
  'block.insert',
  'block.update',
  'block.delete',
  'block.move',
  'page.update_title',
]);
export type OpType = z.infer<typeof OpTypeSchema>;

export const SyncOpSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1), // typically pageId
  tenantId: z.string().min(1),
  type: OpTypeSchema,
  payload: z.record(z.unknown()),
  actorId: z.string().min(1),
  ts: z.string(), // ISO
  /** Monotonic per room in stub; real CRDT uses vector clocks / Lamport */
  seq: z.number().int().nonnegative(),
});
export type SyncOp = z.infer<typeof SyncOpSchema>;

export type PresenceUser = {
  userId: string;
  displayName?: string;
  lastSeenAt: string;
  cursor?: { blockId?: string; offset?: number };
};

export type RoomState = {
  roomId: string;
  tenantId: string;
  presence: Map<string, PresenceUser>;
  ops: SyncOp[];
  nextSeq: number;
};

export type OpListener = (op: SyncOp) => void;

/**
 * Contract future CRDT adapter must satisfy.
 * Stub implements apply/subscribe for one process only.
 */
export interface RealtimeSyncEngine {
  joinPresence(
    tenantId: string,
    roomId: string,
    user: { userId: string; displayName?: string },
  ): Promise<PresenceUser[]>;
  leavePresence(tenantId: string, roomId: string, userId: string): Promise<void>;
  listPresence(tenantId: string, roomId: string): Promise<PresenceUser[]>;
  updateCursor(
    tenantId: string,
    roomId: string,
    userId: string,
    cursor: PresenceUser['cursor'],
  ): Promise<void>;
  appendOp(
    op: Omit<SyncOp, 'id' | 'seq' | 'ts'> & { id?: string; ts?: string },
  ): Promise<SyncOp>;
  listOps(tenantId: string, roomId: string, afterSeq?: number): Promise<SyncOp[]>;
  subscribe(tenantId: string, roomId: string, listener: OpListener): () => void;
  /**
   * Multi-replica merge — NOT implemented in stub.
   * Always throws NOT_IMPLEMENTED until CRDT lands.
   */
  mergeRemoteOps(tenantId: string, roomId: string, remoteOps: SyncOp[]): Promise<SyncOp[]>;
}

function roomKey(tenantId: string, roomId: string) {
  return `\( {tenantId}:: \){roomId}`;
}

export function createStubRealtimeEngine(): RealtimeSyncEngine {
  const rooms = new Map<string, RoomState>();
  const listeners = new Map<string, Set<OpListener>>();

  function getRoom(tenantId: string, roomId: string): RoomState {
    const k = roomKey(tenantId, roomId);
    let r = rooms.get(k);
    if (!r) {
      r = {
        roomId,
        tenantId,
        presence: new Map(),
        ops: [],
        nextSeq: 0,
      };
      rooms.set(k, r);
    }
    return r;
  }

  return {
    async joinPresence(tenantId, roomId, user) {
      const cfg = loadConfig();
      if (!cfg.enabled) throw new RealtimeSyncError('realtime-sync disabled', 'DISABLED', 403);
      if (!cfg.tiers.presence) throw new RealtimeSyncError('presence disabled', 'TIER_PRESENCE');

      const room = getRoom(tenantId, roomId);
      if (room.presence.size >= cfg.limits.maxPresencePerRoom && !room.presence.has(user.userId)) {
        throw new RealtimeSyncError('maxPresencePerRoom exceeded', 'LIMIT_PRESENCE');
      }
      const entry: PresenceUser = {
        userId: user.userId,
        displayName: user.displayName,
        lastSeenAt: new Date().toISOString(),
      };
      room.presence.set(user.userId, entry);
      return [...room.presence.values()];
    },

    async leavePresence(tenantId, roomId, userId) {
      const room = getRoom(tenantId, roomId);
      room.presence.delete(userId);
    },

    async listPresence(tenantId, roomId) {
      return [...getRoom(tenantId, roomId).presence.values()];
    },

    async updateCursor(tenantId, roomId, userId, cursor) {
      const room = getRoom(tenantId, roomId);
      const existing = room.presence.get(userId);
      if (!existing) {
        throw new RealtimeSyncError('User not in presence set', 'NOT_IN_ROOM', 404);
      }
      room.presence.set(userId, {
        ...existing,
        cursor,
        lastSeenAt: new Date().toISOString(),
      });
    },

    async appendOp(partial) {
      const cfg = loadConfig();
      if (!cfg.enabled) throw new RealtimeSyncError('realtime-sync disabled', 'DISABLED', 403);
      if (!cfg.tiers.opLog) throw new RealtimeSyncError('opLog disabled', 'TIER_OPLOG');

      const room = getRoom(partial.tenantId, partial.roomId);
      const op: SyncOp = SyncOpSchema.parse({
        id: partial.id || crypto.randomUUID(),
        roomId: partial.roomId,
        tenantId: partial.tenantId,
        type: partial.type,
        payload: partial.payload,
        actorId: partial.actorId,
        ts: partial.ts || new Date().toISOString(),
        seq: room.nextSeq++,
      });

      room.ops.push(op);
      if (room.ops.length > cfg.limits.maxOpsRetained) {
        room.ops.splice(0, room.ops.length - cfg.limits.maxOpsRetained);
      }

      const k = roomKey(partial.tenantId, partial.roomId);
      const set = listeners.get(k);
      if (set) for (const fn of set) fn(op);

      return op;
    },

    async listOps(tenantId, roomId, afterSeq = -1) {
      const room = getRoom(tenantId, roomId);
      return room.ops.filter((o) => o.seq > afterSeq);
    },

    subscribe(tenantId, roomId, listener) {
      const k = roomKey(tenantId, roomId);
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k)!.add(listener);
      return () => {
        listeners.get(k)?.delete(listener);
      };
    },

    async mergeRemoteOps(_tenantId, _roomId, _remoteOps) {
      const cfg = loadConfig();
      // Honest boundary — never pretend CRDT works
      if (!cfg.tiers.crdtMerge || cfg.stubMode) {
        throw new RealtimeSyncError(
          'NOT_IMPLEMENTED: multi-replica CRDT merge is not available in stubMode. Wire Yjs/Automerge before enabling crdtMerge.',
          'NOT_IMPLEMENTED',
          501,
        );
      }
      throw new RealtimeSyncError('CRDT backend not configured', 'NOT_IMPLEMENTED', 501);
    },
  };
}

/** Default singleton for early wiring — still a stub. */
let defaultEngine: RealtimeSyncEngine | null = null;

export function getRealtimeEngine(): RealtimeSyncEngine {
  if (!defaultEngine) defaultEngine = createStubRealtimeEngine();
  return defaultEngine;
}

export function setRealtimeEngine(engine: RealtimeSyncEngine) {
  defaultEngine = engine;
}
