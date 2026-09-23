import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryStore,
  buildTree,
  validateBlockType,
  validateTitle,
  BlockStoreError,
  loadConfig,
  normalizeOrders,
} from '../index';

describe('block-store', () => {
  let store: ReturnType<typeof createMemoryStore>;
  const T = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    store = createMemoryStore();
  });

  it('loadConfig is enabled with allowed types', () => {
    const cfg = loadConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowedBlockTypes).toContain('paragraph');
  });

  it('validateTitle rejects empty', () => {
    expect(() => validateTitle('  ')).toThrow(BlockStoreError);
  });

  it('validateBlockType rejects unknown', () => {
    expect(() => validateBlockType('magic')).toThrow(/not allowed/);
  });

  it('createPage + insertBlock + getTree', async () => {
    const page = await store.createPage({ tenantId: T, title: 'Ops notes', createdBy: 'u1' });
    await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'heading_1',
      props: { text: 'Shift handoff' },
    });
    await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'paragraph',
      props: { text: 'Boat 3 landed 120kg' },
    });
    await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'to_do',
      props: { text: 'File DFO report', checked: false },
    });

    const { tree } = await store.getTree(T, page.id);
    expect(tree).toHaveLength(3);
    expect(tree[0].type).toBe('heading_1');
    expect(tree[2].props.checked).toBe(false);
  });

  it('nested blocks under parent', async () => {
    const page = await store.createPage({ tenantId: T, title: 'Nested' });
    const parent = await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'bullet',
      props: { text: 'Parent item' },
    });
    await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      parentBlockId: parent.id,
      type: 'bullet',
      props: { text: 'Child item' },
    });
    const { tree } = await store.getTree(T, page.id);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].props.text).toBe('Child item');
  });

  it('updateBlock and deleteBlock cascade', async () => {
    const page = await store.createPage({ tenantId: T, title: 'Edit' });
    const parent = await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'paragraph',
      props: { text: 'old' },
    });
    await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      parentBlockId: parent.id,
      type: 'paragraph',
      props: { text: 'child' },
    });
    await store.updateBlock(T, parent.id, { props: { text: 'new' } });
    const mid = await store.listBlocks(T, page.id);
    expect(mid.find((b) => b.id === parent.id)?.props.text).toBe('new');

    await store.deleteBlock(T, parent.id);
    const left = await store.listBlocks(T, page.id);
    expect(left).toHaveLength(0);
  });

  it('moveBlock reparents', async () => {
    const page = await store.createPage({ tenantId: T, title: 'Move' });
    const a = await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'paragraph',
      props: { text: 'A' },
    });
    const b = await store.insertBlock({
      tenantId: T,
      pageId: page.id,
      type: 'paragraph',
      props: { text: 'B' },
    });
    await store.moveBlock(T, b.id, { parentBlockId: a.id, sortOrder: 0 });
    const { tree } = await store.getTree(T, page.id);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].id).toBe(b.id);
  });

  it('tenant isolation on getPage', async () => {
    const page = await store.createPage({ tenantId: T, title: 'Private' });
    const other = await store.getPage('22222222-2222-2222-2222-222222222222', page.id);
    expect(other).toBeNull();
  });

  it('buildTree sorts by sortOrder', () => {
    const flat = [
      {
        id: '2',
        tenantId: T,
        pageId: 'p',
        parentBlockId: null,
        type: 'paragraph' as const,
        sortOrder: 2,
        props: { text: 'second' },
      },
      {
        id: '1',
        tenantId: T,
        pageId: 'p',
        parentBlockId: null,
        type: 'paragraph' as const,
        sortOrder: 1,
        props: { text: 'first' },
      },
    ];
    const tree = buildTree(flat);
    expect(tree[0].id).toBe('1');
    expect(tree[1].id).toBe('2');
  });

  it('normalizeOrders assigns sequential indices', () => {
    expect(normalizeOrders(['a', 'b', 'c'])).toEqual([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
    ]);
  });
});
