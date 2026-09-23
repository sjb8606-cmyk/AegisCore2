/**
 * @platform/page-permissions
 * Per-page ACL for Option B (Notion-style pages).
 * Roles: viewer < editor < admin. Owner always full access.
 */
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    publicLinks: z.boolean(),
    invites: z.boolean(),
    roleGrants: z.boolean(),
  }),
  limits: z.object({
    maxGrantsPerPage: z.number().int().positive(),
    maxInvitesPerPage: z.number().int().positive(),
    publicLinkTtlHours: z.number().int().positive(),
  }),
  roles: z.array(z.string()),
});

export type PagePermissionsConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: PagePermissionsConfig = {
  enabled: true,
  tiers: { publicLinks: true, invites: true, roleGrants: true },
  limits: {
    maxGrantsPerPage: 100,
    maxInvitesPerPage: 50,
    publicLinkTtlHours: 168,
  },
  roles: ['viewer', 'editor', 'admin'],
};

export function loadConfig(): PagePermissionsConfig {
  const p = path.join(process.cwd(), 'config', 'page-permissions.json');
  try {
    if (fs.existsSync(p)) return ConfigSchema.parse(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) {
    console.warn('[page-permissions] config load failed:', e);
  }
  return DEFAULT_CONFIG;
}

export const PageRoleSchema = z.enum(['viewer', 'editor', 'admin']);
export type PageRole = z.infer<typeof PageRoleSchema>;

const ROLE_RANK: Record<PageRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

export type AccessAction = 'read' | 'write' | 'admin' | 'share';

export function roleSatisfies(role: PageRole, action: AccessAction): boolean {
  switch (action) {
    case 'read':
      return ROLE_RANK[role] >= 1;
    case 'write':
      return ROLE_RANK[role] >= 2;
    case 'admin':
    case 'share':
      return ROLE_RANK[role] >= 3;
    default:
      return false;
  }
}

export class PermissionError extends Error {
  constructor(
    message: string,
    public code: string = 'PERMISSION_ERROR',
    public statusCode: number = 403,
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

export type Grant = {
  id: string;
  tenantId: string;
  pageId: string;
  userId: string;
  role: PageRole;
  grantedBy: string;
  createdAt: string;
};

export type Invite = {
  id: string;
  tenantId: string;
  pageId: string;
  email: string;
  role: PageRole;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
};

export type PublicLink = {
  id: string;
  tenantId: string;
  pageId: string;
  tokenHash: string;
  role: PageRole; // usually viewer
  createdBy: string;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
};

export type PageMeta = {
  pageId: string;
  tenantId: string;
  ownerId: string;
};

function assertEnabled(cfg = loadConfig()) {
  if (!cfg.enabled) throw new PermissionError('page-permissions disabled', 'DISABLED', 403);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createMemoryPermissionStore() {
  const pages = new Map<string, PageMeta>(); // key pageId
  const grants: Grant[] = [];
  const invites: Invite[] = [];
  const links: PublicLink[] = [];

  return {
    registerPage(meta: PageMeta) {
      pages.set(meta.pageId, meta);
    },

    getPage(pageId: string): PageMeta | undefined {
      return pages.get(pageId);
    },

    async grantRole(input: {
      tenantId: string;
      pageId: string;
      userId: string;
      role: PageRole;
      grantedBy: string;
    }): Promise<Grant> {
      const cfg = loadConfig();
      assertEnabled(cfg);
      if (!cfg.tiers.roleGrants) {
        throw new PermissionError('role grants disabled', 'TIER_GRANTS');
      }
      const page = pages.get(input.pageId);
      if (!page || page.tenantId !== input.tenantId) {
        throw new PermissionError('Page not found', 'NOT_FOUND', 404);
      }
      // only owner or admin may grant
      const actorRole = await this.resolveRole(input.tenantId, input.pageId, input.grantedBy);
      if (!actorRole || !roleSatisfies(actorRole, 'share')) {
        throw new PermissionError('Not allowed to share this page', 'FORBIDDEN', 403);
      }
      const existing = grants.filter((g) => g.pageId === input.pageId && g.tenantId === input.tenantId);
      if (existing.length >= cfg.limits.maxGrantsPerPage) {
        throw new PermissionError('maxGrantsPerPage exceeded', 'LIMIT_GRANTS');
      }
      // upsert by user
      const idx = grants.findIndex(
        (g) => g.pageId === input.pageId && g.userId === input.userId && g.tenantId === input.tenantId,
      );
      const grant: Grant = {
        id: idx >= 0 ? grants[idx].id : crypto.randomUUID(),
        tenantId: input.tenantId,
        pageId: input.pageId,
        userId: input.userId,
        role: input.role,
        grantedBy: input.grantedBy,
        createdAt: new Date().toISOString(),
      };
      if (idx >= 0) grants[idx] = grant;
      else grants.push(grant);
      return grant;
    },

    async revokeRole(tenantId: string, pageId: string, userId: string, actorId: string): Promise<void> {
      assertEnabled();
      const actorRole = await this.resolveRole(tenantId, pageId, actorId);
      if (!actorRole || !roleSatisfies(actorRole, 'share')) {
        throw new PermissionError('Not allowed to revoke', 'FORBIDDEN', 403);
      }
      const page = pages.get(pageId);
      if (page?.ownerId === userId) {
        throw new PermissionError('Cannot revoke owner', 'CANNOT_REVOKE_OWNER');
      }
      const i = grants.findIndex(
        (g) => g.tenantId === tenantId && g.pageId === pageId && g.userId === userId,
      );
      if (i >= 0) grants.splice(i, 1);
    },

    async listGrants(tenantId: string, pageId: string): Promise<Grant[]> {
      return grants.filter((g) => g.tenantId === tenantId && g.pageId === pageId);
    },

    async resolveRole(tenantId: string, pageId: string, userId: string): Promise<PageRole | null> {
      const page = pages.get(pageId);
      if (!page || page.tenantId !== tenantId) return null;
      if (page.ownerId === userId) return 'admin';
      const g = grants.find(
        (x) => x.tenantId === tenantId && x.pageId === pageId && x.userId === userId,
      );
      return g?.role ?? null;
    },

    async checkAccess(
      tenantId: string,
      pageId: string,
      userId: string,
      action: AccessAction,
    ): Promise<boolean> {
      const role = await this.resolveRole(tenantId, pageId, userId);
      if (!role) return false;
      return roleSatisfies(role, action);
    },

    async createInvite(input: {
      tenantId: string;
      pageId: string;
      email: string;
      role: PageRole;
      invitedBy: string;
    }): Promise<Invite> {
      const cfg = loadConfig();
      assertEnabled(cfg);
      if (!cfg.tiers.invites) throw new PermissionError('invites disabled', 'TIER_INVITES');
      const actorRole = await this.resolveRole(input.tenantId, input.pageId, input.invitedBy);
      if (!actorRole || !roleSatisfies(actorRole, 'share')) {
        throw new PermissionError('Not allowed to invite', 'FORBIDDEN', 403);
      }
      const pending = invites.filter(
        (i) => i.pageId === input.pageId && i.status === 'pending' && i.tenantId === input.tenantId,
      );
      if (pending.length >= cfg.limits.maxInvitesPerPage) {
        throw new PermissionError('maxInvitesPerPage exceeded', 'LIMIT_INVITES');
      }
      const invite: Invite = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        pageId: input.pageId,
        email: input.email.toLowerCase(),
        role: input.role,
        status: 'pending',
        invitedBy: input.invitedBy,
        createdAt: new Date().toISOString(),
      };
      invites.push(invite);
      return invite;
    },

    async acceptInvite(input: {
      tenantId: string;
      inviteId: string;
      userId: string;
      email: string;
    }): Promise<Grant> {
      const invite = invites.find((i) => i.id === input.inviteId && i.tenantId === input.tenantId);
      if (!invite || invite.status !== 'pending') {
        throw new PermissionError('Invite not found', 'NOT_FOUND', 404);
      }
      if (invite.email !== input.email.toLowerCase()) {
        throw new PermissionError('Invite email mismatch', 'EMAIL_MISMATCH', 403);
      }
      invite.status = 'accepted';
      return this.grantRole({
        tenantId: input.tenantId,
        pageId: invite.pageId,
        userId: input.userId,
        role: invite.role,
        grantedBy: invite.invitedBy,
      });
    },

    async createPublicLink(input: {
      tenantId: string;
      pageId: string;
      role: PageRole;
      createdBy: string;
    }): Promise<{ link: PublicLink; token: string }> {
      const cfg = loadConfig();
      assertEnabled(cfg);
      if (!cfg.tiers.publicLinks) {
        throw new PermissionError('public links disabled', 'TIER_PUBLIC');
      }
      if (input.role === 'admin') {
        throw new PermissionError('public links cannot grant admin', 'INVALID_PUBLIC_ROLE');
      }
      const actorRole = await this.resolveRole(input.tenantId, input.pageId, input.createdBy);
      if (!actorRole || !roleSatisfies(actorRole, 'share')) {
        throw new PermissionError('Not allowed to create public link', 'FORBIDDEN', 403);
      }
      const token = randomBytes(24).toString('base64url');
      const expires = new Date();
      expires.setHours(expires.getHours() + cfg.limits.publicLinkTtlHours);
      const link: PublicLink = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        pageId: input.pageId,
        tokenHash: hashToken(token),
        role: input.role,
        createdBy: input.createdBy,
        expiresAt: expires.toISOString(),
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      links.push(link);
      return { link, token };
    },

    async revokePublicLink(tenantId: string, linkId: string, actorId: string): Promise<void> {
      const link = links.find((l) => l.id === linkId && l.tenantId === tenantId);
      if (!link) throw new PermissionError('Link not found', 'NOT_FOUND', 404);
      const actorRole = await this.resolveRole(tenantId, link.pageId, actorId);
      if (!actorRole || !roleSatisfies(actorRole, 'share')) {
        throw new PermissionError('Not allowed to revoke link', 'FORBIDDEN', 403);
      }
      link.revoked = true;
    },

    async resolvePublicToken(token: string): Promise<{ pageId: string; tenantId: string; role: PageRole } | null> {
      const h = hashToken(token);
      const now = Date.now();
      const link = links.find((l) => l.tokenHash === h && !l.revoked);
      if (!link) return null;
      if (new Date(link.expiresAt).getTime() < now) return null;
      return { pageId: link.pageId, tenantId: link.tenantId, role: link.role };
    },
  };
}

export type MemoryPermissionStore = ReturnType<typeof createMemoryPermissionStore>;
