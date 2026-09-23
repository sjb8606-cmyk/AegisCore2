/**
 * @platform/block-store
 * Option B foundation: pages as ordered trees of typed blocks.
 * Not realtime collab — data model + CRUD only.
 */
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    nestedPages: z.boolean(),
    todoBlocks: z.boolean(),
    codeBlocks: z.boolean(),
  }),
  limits: z.object({
    maxBlocksPerPage: z.number().int().positive(),
    maxDepth: z.number().int().positive(),
    maxTitleLength: z.number().int().positive(),
    maxTextLength: z.number().int().positive(),
  }),
  allowedBlockTypes: z.array(z.string()),
});

export type BlockStoreConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: BlockStoreConfig = {
  enabled: true,
  tiers: { nestedPages: true, todoBlocks: true, codeBlocks: true },
  limits: {
    maxBlocksPerPage: 500,
    maxDepth: 20,
    maxTitleLength: 200,
    maxTextLength: 20000,
  },
  allowedBlockTypes: [
    'paragraph',
    'heading_1',
    'heading_2',
    'heading_3',
    'bullet',
    'numbered',
    'to_do',
    'divider',
    'code',
    'quote',
    'page',
  ],
};

export function loadConfig(): BlockStoreConfig {
  const configPath = path.join(process.cwd(), 'config', 'block-store.json');
  try {
    if (fs.existsSync(configPath)) {
      return ConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    }
  } catch (err) {
    console.warn('[block-store] config load failed, using defaults:', err);
  }
  return DEFAULT_CONFIG;
}

// ── Types ─────────────────────────────────────────────────────

export const BlockTypeSchema = z.enum([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bullet',
  'numbered',
  'to_do',
  'divider',
  'code',
  'quote',
  'page',
]);
export type BlockType = z.infer<typeof BlockTypeSchema>;

export const BlockPropsSchema = z
  .object({
    text: z.string().optional(),
    checked: z.boolean().optional(),
    language: z.string().optional(),
    linkedPageId: z.string().optional(),
  })
  .passthrough();

export type BlockProps = z.infer<typeof BlockPropsSchema>;

export type BlockRecord = {
  id: string;
  tenantId: string;
  pageId: string;
  parentBlockId: string | null;
  type: BlockType;
  sortOrder: number;
  props: BlockProps;
};

export type PageRecord = {
  id: string;
  tenantId: string;
  title: string;
  parentPageId: string | null;
  createdBy?: string;
};

export type BlockNode = BlockRecord & { children: BlockNode[] };

export class BlockStoreError extends Error {
  constructor(
    message: string,
    public code: string = 'BLOCK_STORE_ERROR',
    public statusCode: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'BlockStoreError';
  }
}

// ── Pure validation ───────────────────────────────────────────

export function assertEnabled(cfg: BlockStoreConfig = loadConfig()) {
  if (!cfg.enabled) {
    throw new BlockStoreError('block-store is disabled', 'DISABLED', 403);
  }
}

export function validateBlockType(type: string, cfg: BlockStoreConfig = loadConfig()): BlockType {
  assertEnabled(cfg);
  if (!cfg.allowedBlockTypes.includes(type)) {
    throw new BlockStoreError(`Block type not allowed: ${type}`, 'INVALID_TYPE');
  }
  if (type === 'to_do' && !cfg.tiers.todoBlocks) {
    throw new BlockStoreError('to_do blocks disabled by tier', 'TIER_TODO');
  }
  if (type === 'code' && !cfg.tiers.codeBlocks) {
    throw new BlockStoreError('code blocks disabled by tier', 'TIER_CODE');
  }
  if (type === 'page' && !cfg.tiers.nestedPages) {
    throw new BlockStoreError('nested page blocks disabled by tier', 'TIER_PAGE');
  }
  return type as BlockType;
}

export function validateProps(type: BlockType, props: unknown, cfg: BlockStoreConfig = loadConfig()): BlockProps {
  const parsed = BlockPropsSchema.safeParse(props ?? {});
  if (!parsed.success) {
    throw new BlockStoreError('Invalid block props', 'INVALID_PROPS', 400, parsed.error.flatten());
  }
  const p = parsed.data;
  if (p.text !== undefined && p.text.length > cfg.limits.maxTextLength) {
    throw new BlockStoreError('Block text too long', 'LIMIT_TEXT');
  }
  if (type === 'to_do' && p.checked === undefined) {
    p.checked = false;
  }
  if (type === 'divider') {
    return {};
  }
  return p;
}

export function validateTitle(title: string, cfg: BlockStoreConfig = loadConfig()) {
  assertEnabled(cfg);
  const t = (title || '').trim();
  if (!t) throw new BlockStoreError('Page title is required', 'TITLE_REQUIRED');
  if (t.length > cfg.limits.maxTitleLength) {
    throw new BlockStoreError('Page title too long', 'LIMIT_TITLE');
  }
  return t;
}

/** Build tree from flat list (parentBlockId + sortOrder). */
export function buildTree(blocks: BlockRecord[]): BlockNode[] {
  const map = new Map<string, BlockNode>();
  for (const b of blocks) {
    map.set(b.id, { ...b, children: [] });
  }
  const roots: BlockNode[] = [];
  const sorted = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const b of sorted) {
    const node = map.get(b.id)!;
    if (b.parentBlockId && map.has(b.parentBlockId)) {
      map.get(b.parentBlockId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortChildren = (n: BlockNode) => {
    n.children.sort((a, b) => a.sortOrder - b.sortOrder);
    n.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);
  return roots;
}

export function countBlocks(nodes: BlockNode[]): number {
  let n = 0;
  const walk = (list: BlockNode[]) => {
    for (const node of list) {
      n += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return n;
}

export function depthOf(nodes: BlockNode[], targetId: string, depth = 0): number | null {
  for (const n of nodes) {
    if (n.id === targetId) return depth;
    const d = depthOf(n.children, targetId, depth + 1);
    if (d !== null) return d;
  }
  return null;
}

/** Reorder helper: assign sortOrder 0..n-1 for siblings list. */
export function normalizeOrders(siblingIds: string[]): Array<{ id: string; sortOrder: number }> {
  return siblingIds.map((id, i) => ({ id, sortOrder: i }));
}

// ── In-memory store (unit tests + offline) ────────────────────

export function createMemoryStore() {
  const pages = new Map<string, PageRecord>();
  const blocks = new Map<string, BlockRecord>();

  return {
    async createPage(input: {
      tenantId: string;
      title: string;
      parentPageId?: string | null;
      createdBy?: string;
    }): Promise<PageRecord> {
      const cfg = loadConfig();
      const title = validateTitle(input.title, cfg);
      if (input.parentPageId && !cfg.tiers.nestedPages) {
        throw new BlockStoreError('Nested pages disabled', 'TIER_PAGE');
      }
      const page: PageRecord = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        title,
        parentPageId: input.parentPageId ?? null,
        createdBy: input.createdBy,
      };
      pages.set(page.id, page);
      return page;
    },

    async getPage(tenantId: string, pageId: string): Promise<PageRecord | null> {
      const p = pages.get(pageId);
      if (!p || p.tenantId !== tenantId) return null;
      return p;
    },

    async listBlocks(tenantId: string, pageId: string): Promise<BlockRecord[]> {
      return [...blocks.values()].filter((b) => b.tenantId === tenantId && b.pageId === pageId);
    },

    async getTree(tenantId: string, pageId: string): Promise<{ page: PageRecord; tree: BlockNode[] }> {
      const page = await this.getPage(tenantId, pageId);
      if (!page) throw new BlockStoreError('Page not found', 'NOT_FOUND', 404);
      const list = await this.listBlocks(tenantId, pageId);
      return { page, tree: buildTree(list) };
    },

    async insertBlock(input: {
      tenantId: string;
      pageId: string;
      type: string;
      props?: unknown;
      parentBlockId?: string | null;
      sortOrder?: number;
    }): Promise<BlockRecord> {
      const cfg = loadConfig();
      const page = await this.getPage(input.tenantId, input.pageId);
      if (!page) throw new BlockStoreError('Page not found', 'NOT_FOUND', 404);

      const existing = await this.listBlocks(input.tenantId, input.pageId);
      if (existing.length >= cfg.limits.maxBlocksPerPage) {
        throw new BlockStoreError('maxBlocksPerPage exceeded', 'LIMIT_BLOCKS');
      }

      const type = validateBlockType(input.type, cfg);
      const props = validateProps(type, input.props, cfg);

      if (input.parentBlockId) {
        const parent = existing.find((b) => b.id === input.parentBlockId);
        if (!parent) throw new BlockStoreError('Parent block not found', 'PARENT_NOT_FOUND', 404);
        const tree = buildTree(existing);
        const d = depthOf(tree, input.parentBlockId);
        if (d !== null && d + 1 >= cfg.limits.maxDepth) {
          throw new BlockStoreError('maxDepth exceeded', 'LIMIT_DEPTH');
        }
      }

      const sortOrder =
        input.sortOrder ??
        existing.filter((b) => (b.parentBlockId ?? null) === (input.parentBlockId ?? null)).length;

      const block: BlockRecord = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        pageId: input.pageId,
        parentBlockId: input.parentBlockId ?? null,
        type,
        sortOrder,
        props,
      };
      blocks.set(block.id, block);
      return block;
    },

    async updateBlock(
      tenantId: string,
      blockId: string,
      patch: { props?: unknown; type?: string },
    ): Promise<BlockRecord> {
      const cfg = loadConfig();
      const block = blocks.get(blockId);
      if (!block || block.tenantId !== tenantId) {
        throw new BlockStoreError('Block not found', 'NOT_FOUND', 404);
      }
      const type = patch.type ? validateBlockType(patch.type, cfg) : block.type;
      const props =
        patch.props !== undefined ? validateProps(type, patch.props, cfg) : block.props;
      const next = { ...block, type, props };
      blocks.set(blockId, next);
      return next;
    },

    async deleteBlock(tenantId: string, blockId: string): Promise<void> {
      const block = blocks.get(blockId);
      if (!block || block.tenantId !== tenantId) {
        throw new BlockStoreError('Block not found', 'NOT_FOUND', 404);
      }
      // cascade children
      const all = [...blocks.values()].filter((b) => b.pageId === block.pageId);
      const toDelete = new Set<string>([blockId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const b of all) {
          if (b.parentBlockId && toDelete.has(b.parentBlockId) && !toDelete.has(b.id)) {
            toDelete.add(b.id);
            changed = true;
          }
        }
      }
      for (const id of toDelete) blocks.delete(id);
    },

    async moveBlock(
      tenantId: string,
      blockId: string,
      opts: { parentBlockId: string | null; sortOrder: number },
    ): Promise<BlockRecord> {
      const block = blocks.get(blockId);
      if (!block || block.tenantId !== tenantId) {
        throw new BlockStoreError('Block not found', 'NOT_FOUND', 404);
      }
      if (opts.parentBlockId === blockId) {
        throw new BlockStoreError('Cannot parent block to itself', 'INVALID_MOVE');
      }
      const next = {
        ...block,
        parentBlockId: opts.parentBlockId,
        sortOrder: opts.sortOrder,
      };
      blocks.set(blockId, next);
      return next;
    },
  };
}

export type MemoryBlockStore = ReturnType<typeof createMemoryStore>;
