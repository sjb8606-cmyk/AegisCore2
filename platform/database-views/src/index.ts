/**
 * @platform/database-views
 * Option B: same rows, multiple views (table / board / calendar / gallery).
 */
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    boardView: z.boolean(),
    calendarView: z.boolean(),
    galleryView: z.boolean(),
    filters: z.boolean(),
  }),
  limits: z.object({
    maxProperties: z.number().int().positive(),
    maxRowsPerCollection: z.number().int().positive(),
    maxViewsPerCollection: z.number().int().positive(),
  }),
  allowedPropertyTypes: z.array(z.string()),
});

export type DatabaseViewsConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: DatabaseViewsConfig = {
  enabled: true,
  tiers: { boardView: true, calendarView: true, galleryView: true, filters: true },
  limits: { maxProperties: 40, maxRowsPerCollection: 5000, maxViewsPerCollection: 20 },
  allowedPropertyTypes: ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'],
};

export function loadConfig(): DatabaseViewsConfig {
  const p = path.join(process.cwd(), 'config', 'database-views.json');
  try {
    if (fs.existsSync(p)) return ConfigSchema.parse(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch (e) {
    console.warn('[database-views] config load failed:', e);
  }
  return DEFAULT_CONFIG;
}

export const PropertyTypeSchema = z.enum([
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PropertyDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: PropertyTypeSchema,
  options: z.array(z.string()).optional(), // select / multi_select
});
export type PropertyDef = z.infer<typeof PropertyDefSchema>;

export const ViewTypeSchema = z.enum(['table', 'board', 'calendar', 'gallery']);
export type ViewType = z.infer<typeof ViewTypeSchema>;

export const ViewDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: ViewTypeSchema,
  /** board: property id of type select */
  groupByPropertyId: z.string().optional(),
  /** calendar: property id of type date */
  datePropertyId: z.string().optional(),
  /** gallery: property id used as title (text) */
  titlePropertyId: z.string().optional(),
  sorts: z
    .array(
      z.object({
        propertyId: z.string(),
        direction: z.enum(['asc', 'desc']),
      }),
    )
    .optional(),
  filters: z
    .array(
      z.object({
        propertyId: z.string(),
        op: z.enum(['eq', 'neq', 'contains', 'gt', 'lt']),
        value: z.unknown(),
      }),
    )
    .optional(),
});
export type ViewDef = z.infer<typeof ViewDefSchema>;

export type Collection = {
  id: string;
  tenantId: string;
  name: string;
  properties: PropertyDef[];
  views: ViewDef[];
  createdBy: string;
  createdAt: string;
};

export type Row = {
  id: string;
  collectionId: string;
  tenantId: string;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export class DatabaseViewsError extends Error {
  constructor(
    message: string,
    public code: string = 'DB_VIEWS_ERROR',
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'DatabaseViewsError';
  }
}

function assertEnabled(cfg = loadConfig()) {
  if (!cfg.enabled) throw new DatabaseViewsError('database-views disabled', 'DISABLED', 403);
}

export function applyFilters(
  rows: Row[],
  filters: ViewDef['filters'],
  cfg = loadConfig(),
): Row[] {
  if (!filters?.length) return rows;
  if (!cfg.tiers.filters) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const v = row.values[f.propertyId];
      switch (f.op) {
        case 'eq':
          return v === f.value;
        case 'neq':
          return v !== f.value;
        case 'contains':
          return String(v ?? '').includes(String(f.value ?? ''));
        case 'gt':
          return Number(v) > Number(f.value);
        case 'lt':
          return Number(v) < Number(f.value);
        default:
          return true;
      }
    }),
  );
}

export function applySorts(rows: Row[], sorts: ViewDef['sorts']): Row[] {
  if (!sorts?.length) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of sorts) {
      const av = a.values[s.propertyId];
      const bv = b.values[s.propertyId];
      let cmp = 0;
      if (av === bv) cmp = 0;
      else if (av == null) cmp = 1;
      else if (bv == null) cmp = -1;
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return s.direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return out;
}

export type TableViewResult = { type: 'table'; rows: Row[] };
export type BoardViewResult = {
  type: 'board';
  groupByPropertyId: string;
  columns: Array<{ option: string; rows: Row[] }>;
};
export type CalendarViewResult = {
  type: 'calendar';
  datePropertyId: string;
  days: Array<{ date: string; rows: Row[] }>;
};
export type GalleryViewResult = {
  type: 'gallery';
  cards: Array<{ rowId: string; title: string; values: Record<string, unknown> }>;
};

export type ViewResult = TableViewResult | BoardViewResult | CalendarViewResult | GalleryViewResult;

export function materializeView(
  collection: Collection,
  view: ViewDef,
  rows: Row[],
  cfg = loadConfig(),
): ViewResult {
  assertEnabled(cfg);
  let list = applyFilters(rows, view.filters, cfg);
  list = applySorts(list, view.sorts);

  switch (view.type) {
    case 'table':
      return { type: 'table', rows: list };

    case 'board': {
      if (!cfg.tiers.boardView) throw new DatabaseViewsError('board view disabled', 'TIER_BOARD');
      const propId = view.groupByPropertyId;
      if (!propId) throw new DatabaseViewsError('board requires groupByPropertyId', 'BOARD_CONFIG');
      const prop = collection.properties.find((p) => p.id === propId);
      if (!prop || prop.type !== 'select') {
        throw new DatabaseViewsError('groupBy must be a select property', 'BOARD_PROP');
      }
      const options = prop.options?.length ? prop.options : ['_empty'];
      const columns = options.map((option) => ({
        option,
        rows: list.filter((r) => (r.values[propId] ?? '_empty') === option),
      }));
      // rows with unknown option
      const known = new Set(options);
      const extra = list.filter((r) => !known.has(String(r.values[propId] ?? '_empty')));
      if (extra.length) columns.push({ option: '_other', rows: extra });
      return { type: 'board', groupByPropertyId: propId, columns };
    }

    case 'calendar': {
      if (!cfg.tiers.calendarView) {
        throw new DatabaseViewsError('calendar view disabled', 'TIER_CALENDAR');
      }
      const propId = view.datePropertyId;
      if (!propId) throw new DatabaseViewsError('calendar requires datePropertyId', 'CAL_CONFIG');
      const prop = collection.properties.find((p) => p.id === propId);
      if (!prop || prop.type !== 'date') {
        throw new DatabaseViewsError('datePropertyId must be date type', 'CAL_PROP');
      }
      const map = new Map<string, Row[]>();
      for (const row of list) {
        const raw = row.values[propId];
        const key = raw ? String(raw).slice(0, 10) : '_none';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(row);
      }
      const days = [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => ({ date, rows }));
      return { type: 'calendar', datePropertyId: propId, days };
    }

    case 'gallery': {
      if (!cfg.tiers.galleryView) {
        throw new DatabaseViewsError('gallery view disabled', 'TIER_GALLERY');
      }
      const titleId =
        view.titlePropertyId ||
        collection.properties.find((p) => p.type === 'text')?.id ||
        collection.properties[0]?.id;
      const cards = list.map((row) => ({
        rowId: row.id,
        title: titleId ? String(row.values[titleId] ?? 'Untitled') : 'Untitled',
        values: row.values,
      }));
      return { type: 'gallery', cards };
    }

    default:
      throw new DatabaseViewsError(`Unknown view type`, 'INVALID_VIEW');
  }
}

export function createMemoryDatabaseStore() {
  const collections = new Map<string, Collection>();
  const rows = new Map<string, Row[]>(); // collectionId -> rows

  return {
    async createCollection(input: {
      tenantId: string;
      name: string;
      properties: PropertyDef[];
      createdBy: string;
    }): Promise<Collection> {
      const cfg = loadConfig();
      assertEnabled(cfg);
      if (input.properties.length > cfg.limits.maxProperties) {
        throw new DatabaseViewsError('maxProperties exceeded', 'LIMIT_PROPS');
      }
      for (const p of input.properties) {
        if (!cfg.allowedPropertyTypes.includes(p.type)) {
          throw new DatabaseViewsError(`Property type not allowed: ${p.type}`, 'INVALID_PROP_TYPE');
        }
        if ((p.type === 'select' || p.type === 'multi_select') && !p.options?.length) {
          throw new DatabaseViewsError(`Select property ${p.name} needs options`, 'SELECT_OPTIONS');
        }
      }
      const col: Collection = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        properties: input.properties,
        views: [
          {
            id: crypto.randomUUID(),
            name: 'Table',
            type: 'table',
          },
        ],
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
      };
      collections.set(col.id, col);
      rows.set(col.id, []);
      return col;
    },

    async getCollection(tenantId: string, id: string): Promise<Collection | null> {
      const c = collections.get(id);
      if (!c || c.tenantId !== tenantId) return null;
      return c;
    },

    async addView(tenantId: string, collectionId: string, view: Omit<ViewDef, 'id'> & { id?: string }) {
      const cfg = loadConfig();
      const col = collections.get(collectionId);
      if (!col || col.tenantId !== tenantId) {
        throw new DatabaseViewsError('Collection not found', 'NOT_FOUND', 404);
      }
      if (col.views.length >= cfg.limits.maxViewsPerCollection) {
        throw new DatabaseViewsError('maxViewsPerCollection exceeded', 'LIMIT_VIEWS');
      }
      const parsed = ViewDefSchema.parse({ ...view, id: view.id || crypto.randomUUID() });
      col.views.push(parsed);
      return parsed;
    },

    async addRow(tenantId: string, collectionId: string, values: Record<string, unknown>): Promise<Row> {
      const cfg = loadConfig();
      const col = collections.get(collectionId);
      if (!col || col.tenantId !== tenantId) {
        throw new DatabaseViewsError('Collection not found', 'NOT_FOUND', 404);
      }
      const list = rows.get(collectionId) || [];
      if (list.length >= cfg.limits.maxRowsPerCollection) {
        throw new DatabaseViewsError('maxRowsPerCollection exceeded', 'LIMIT_ROWS');
      }
      // strip unknown property ids
      const allowed = new Set(col.properties.map((p) => p.id));
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (allowed.has(k)) clean[k] = v;
      }
      const row: Row = {
        id: crypto.randomUUID(),
        collectionId,
        tenantId,
        values: clean,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(row);
      rows.set(collectionId, list);
      return row;
    },

    async listRows(tenantId: string, collectionId: string): Promise<Row[]> {
      const col = collections.get(collectionId);
      if (!col || col.tenantId !== tenantId) {
        throw new DatabaseViewsError('Collection not found', 'NOT_FOUND', 404);
      }
      return [...(rows.get(collectionId) || [])];
    },

    async queryView(tenantId: string, collectionId: string, viewId: string): Promise<ViewResult> {
      const col = collections.get(collectionId);
      if (!col || col.tenantId !== tenantId) {
        throw new DatabaseViewsError('Collection not found', 'NOT_FOUND', 404);
      }
      const view = col.views.find((v) => v.id === viewId);
      if (!view) throw new DatabaseViewsError('View not found', 'VIEW_NOT_FOUND', 404);
      const list = await this.listRows(tenantId, collectionId);
      return materializeView(col, view, list);
    },
  };
}

export type MemoryDatabaseStore = ReturnType<typeof createMemoryDatabaseStore>;
