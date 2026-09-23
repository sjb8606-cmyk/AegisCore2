import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryDatabaseStore,
  materializeView,
  applyFilters,
  applySorts,
  loadConfig,
} from '../index';

const T = '11111111-1111-1111-1111-111111111111';
const U = '22222222-2222-2222-2222-222222222222';

const props = [
  { id: 'title', name: 'Title', type: 'text' as const },
  { id: 'status', name: 'Status', type: 'select' as const, options: ['todo', 'doing', 'done'] },
  { id: 'due', name: 'Due', type: 'date' as const },
  { id: 'weight', name: 'Weight', type: 'number' as const },
];

describe('database-views', () => {
  let store: ReturnType<typeof createMemoryDatabaseStore>;

  beforeEach(() => {
    store = createMemoryDatabaseStore();
  });

  it('loadConfig enabled', () => {
    expect(loadConfig().enabled).toBe(true);
  });

  it('create collection with default table view', async () => {
    const col = await store.createCollection({
      tenantId: T,
      name: 'Shipments',
      properties: props,
      createdBy: U,
    });
    expect(col.views[0].type).toBe('table');
  });

  it('table view returns sorted filtered rows', async () => {
    const col = await store.createCollection({
      tenantId: T,
      name: 'S',
      properties: props,
      createdBy: U,
    });
    await store.addRow(T, col.id, { title: 'A', status: 'todo', weight: 10 });
    await store.addRow(T, col.id, { title: 'B', status: 'done', weight: 30 });
    await store.addRow(T, col.id, { title: 'C', status: 'todo', weight: 20 });

    const viewId = col.views[0].id;
    // patch view with sort+filter via addView
    const v = await store.addView(T, col.id, {
      name: 'Todos by weight',
      type: 'table',
      filters: [{ propertyId: 'status', op: 'eq', value: 'todo' }],
      sorts: [{ propertyId: 'weight', direction: 'asc' }],
    });
    const result = await store.queryView(T, col.id, v.id);
    expect(result.type).toBe('table');
    if (result.type === 'table') {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].values.title).toBe('A');
      expect(result.rows[1].values.title).toBe('C');
    }
  });

  it('board groups by select', async () => {
    const col = await store.createCollection({
      tenantId: T,
      name: 'Kanban',
      properties: props,
      createdBy: U,
    });
    await store.addRow(T, col.id, { title: '1', status: 'todo' });
    await store.addRow(T, col.id, { title: '2', status: 'doing' });
    await store.addRow(T, col.id, { title: '3', status: 'todo' });
    const board = await store.addView(T, col.id, {
      name: 'Board',
      type: 'board',
      groupByPropertyId: 'status',
    });
    const result = await store.queryView(T, col.id, board.id);
    expect(result.type).toBe('board');
    if (result.type === 'board') {
      const todo = result.columns.find((c) => c.option === 'todo');
      expect(todo?.rows).toHaveLength(2);
    }
  });

  it('calendar buckets by date', async () => {
    const col = await store.createCollection({
      tenantId: T,
      name: 'Cal',
      properties: props,
      createdBy: U,
    });
    await store.addRow(T, col.id, { title: 'X', due: '2026-09-21' });
    await store.addRow(T, col.id, { title: 'Y', due: '2026-09-21' });
    await store.addRow(T, col.id, { title: 'Z', due: '2026-09-22' });
    const cal = await store.addView(T, col.id, {
      name: 'Calendar',
      type: 'calendar',
      datePropertyId: 'due',
    });
    const result = await store.queryView(T, col.id, cal.id);
    expect(result.type).toBe('calendar');
    if (result.type === 'calendar') {
      expect(result.days.find((d) => d.date === '2026-09-21')?.rows).toHaveLength(2);
    }
  });

  it('gallery cards use title property', async () => {
    const col = await store.createCollection({
      tenantId: T,
      name: 'Gal',
      properties: props,
      createdBy: U,
    });
    await store.addRow(T, col.id, { title: 'Lobster lot' });
    const gal = await store.addView(T, col.id, {
      name: 'Gallery',
      type: 'gallery',
      titlePropertyId: 'title',
    });
    const result = await store.queryView(T, col.id, gal.id);
    expect(result.type).toBe('gallery');
    if (result.type === 'gallery') {
      expect(result.cards[0].title).toBe('Lobster lot');
    }
  });

  it('applyFilters and applySorts pure helpers', () => {
    const rows = [
      {
        id: '1',
        collectionId: 'c',
        tenantId: T,
        values: { status: 'a', n: 2 },
        createdAt: '',
        updatedAt: '',
      },
      {
        id: '2',
        collectionId: 'c',
        tenantId: T,
        values: { status: 'b', n: 1 },
        createdAt: '',
        updatedAt: '',
      },
    ];
    const filtered = applyFilters(rows, [{ propertyId: 'status', op: 'eq', value: 'a' }]);
    expect(filtered).toHaveLength(1);
    const sorted = applySorts(rows, [{ propertyId: 'n', direction: 'asc' }]);
    expect(sorted[0].id).toBe('2');
  });
});
