/**
 * @platform/shared-workspaces
 * Tenant collaborative workspaces. Optional rootPageId links to block-store.
 */
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    memberLists: z.boolean(),
    rootPageLink: z.boolean(),
  }),
  limits: z.object({
    maxWorkspacesPerTenant: z.number().int().positive(),
    maxMembersPerWorkspace: z.number().int().positive(),
    maxNameLength: z.number().int().positive(),
  }),
});

export type SharedWorkspacesConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: SharedWorkspacesConfig = {
  enabled: true,
  tiers: { memberLists: true, rootPageLink: true },
  limits: {
    maxWorkspacesPerTenant: 100,
    maxMembersPerWorkspace: 50,
    maxNameLength: 255,
  },
};

export function loadConfig(): SharedWorkspacesConfig {
  const p = path.join(process.cwd(), 'config', 'shared-workspaces.json');
  try {
    if (fs.existsSync(p)) return ConfigSchema.parse(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) {
    console.warn('[shared-workspaces] config load failed:', e);
  }
  return DEFAULT_CONFIG;
}

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  memberIds: z.array(z.string().uuid()).default([]),
  rootPageId: z.string().uuid().optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

export type WorkspaceRecord = {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description: string | null;
  memberIds: string[];
  rootPageId: string | null;
  createdAt?: string;
};

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public code: string = 'WORKSPACE_ERROR',
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export function assertEnabled(cfg = loadConfig()) {
  if (!cfg.enabled) throw new WorkspaceError('shared-workspaces disabled', 'DISABLED', 403);
}

export function validateCreateInput(raw: unknown, cfg = loadConfig()): CreateWorkspaceInput {
  assertEnabled(cfg);
  const parsed = CreateWorkspaceInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkspaceError('Invalid workspace payload', 'INVALID_INPUT');
  }
  const input = parsed.data;
  if (input.name.length > cfg.limits.maxNameLength) {
    throw new WorkspaceError('Name too long', 'LIMIT_NAME');
  }
  if (!cfg.tiers.memberLists && input.memberIds.length > 0) {
    throw new WorkspaceError('Member lists disabled by tier', 'TIER_MEMBERS');
  }
  if (input.memberIds.length > cfg.limits.maxMembersPerWorkspace) {
    throw new WorkspaceError('Too many members', 'LIMIT_MEMBERS');
  }
  if (input.rootPageId && !cfg.tiers.rootPageLink) {
    throw new WorkspaceError('rootPageId disabled by tier', 'TIER_ROOT_PAGE');
  }
  return input;
}

/** Encode optional rootPageId into description JSON envelope (no migration required). */
export function encodeDescription(description: string | undefined, rootPageId?: string | null): string | null {
  if (!rootPageId && !description) return null;
  if (!rootPageId) return description ?? null;
  return JSON.stringify({ text: description ?? '', rootPageId });
}

export function decodeDescription(raw: string | null): { text: string | null; rootPageId: string | null } {
  if (!raw) return { text: null, rootPageId: null };
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && ('rootPageId' in j || 'text' in j)) {
      return { text: j.text ?? null, rootPageId: j.rootPageId ?? null };
    }
  } catch {
    /* plain text */
  }
  return { text: raw, rootPageId: null };
}

export type WorkspaceDb = {
  list: (tenantId: string, opts: { limit: number; cursor: string | null; sort: 'asc' | 'desc' }) => Promise<any[]>;
  insert: (row: {
    tenantId: string;
    userId: string;
    name: string;
    description: string | null;
    memberIds: string[];
  }) => Promise<any>;
  deleteOwned: (tenantId: string, id: string, userId: string) => Promise<any | null>;
  countForTenant: (tenantId: string) => Promise<number>;
};

export async function listWorkspaces(
  db: WorkspaceDb,
  tenantId: string,
  opts: { limit?: number; cursor?: string | null; sort?: 'asc' | 'desc' } = {},
) {
  assertEnabled();
  const rows = await db.list(tenantId, {
    limit: opts.limit ?? 20,
    cursor: opts.cursor ?? null,
    sort: opts.sort ?? 'desc',
  });
  return rows.map((r) => {
    const { text, rootPageId } = decodeDescription(r.description);
    return {
      id: r.id,
      tenantId,
      userId: r.user_id,
      name: r.name,
      description: text,
      memberIds: r.member_ids ?? [],
      rootPageId,
      createdAt: r.created_at,
    } as WorkspaceRecord;
  });
}

export async function createWorkspace(
  db: WorkspaceDb,
  tenantId: string,
  userId: string,
  raw: unknown,
) {
  const cfg = loadConfig();
  const input = validateCreateInput(raw, cfg);
  const count = await db.countForTenant(tenantId);
  if (count >= cfg.limits.maxWorkspacesPerTenant) {
    throw new WorkspaceError('maxWorkspacesPerTenant exceeded', 'LIMIT_WORKSPACES');
  }
  const description = encodeDescription(input.description, input.rootPageId);
  const row = await db.insert({
    tenantId,
    userId,
    name: input.name,
    description,
    memberIds: input.memberIds,
  });
  const decoded = decodeDescription(row.description);
  return {
    id: row.id,
    tenantId,
    userId: row.user_id,
    name: row.name,
    description: decoded.text,
    memberIds: row.member_ids ?? input.memberIds,
    rootPageId: decoded.rootPageId,
    createdAt: row.created_at,
  } as WorkspaceRecord;
}

export async function deleteWorkspace(db: WorkspaceDb, tenantId: string, id: string, userId: string) {
  assertEnabled();
  const row = await db.deleteOwned(tenantId, id, userId);
  if (!row) throw new WorkspaceError('Workspace not found or not owned by you', 'NOT_FOUND', 404);
  return { id: row.id };
}

/** In-memory DB for unit tests */
export function createMemoryWorkspaceDb(): WorkspaceDb & { _rows: any[] } {
  const rows: any[] = [];
  return {
    _rows: rows,
    async list(tenantId, opts) {
      let list = rows.filter((r) => r.tenant_id === tenantId);
      list.sort((a, b) =>
        opts.sort === 'asc'
          ? String(a.created_at).localeCompare(String(b.created_at))
          : String(b.created_at).localeCompare(String(a.created_at)),
      );
      return list.slice(0, opts.limit);
    },
    async insert(row) {
      const rec = {
        id: crypto.randomUUID(),
        tenant_id: row.tenantId,
        user_id: row.userId,
        name: row.name,
        description: row.description,
        member_ids: row.memberIds,
        created_at: new Date().toISOString(),
      };
      rows.push(rec);
      return rec;
    },
    async deleteOwned(tenantId, id, userId) {
      const i = rows.findIndex((r) => r.id === id && r.tenant_id === tenantId && r.user_id === userId);
      if (i < 0) return null;
      const [removed] = rows.splice(i, 1);
      return removed;
    },
    async countForTenant(tenantId) {
      return rows.filter((r) => r.tenant_id === tenantId).length;
    },
  };
}
