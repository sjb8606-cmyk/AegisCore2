import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/metering', () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({ enabled: true, maxNodes: 500 }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  createDocument,
  updateDocument,
  exportDocument,
  listTemplates,
  __resetCanvasEngineStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('canvas-engine', () => {
  beforeEach(() => {
    __resetCanvasEngineStore();
    vi.clearAllMocks();
  });

  it('creates document', async () => {
    const d = await createDocument(tenantId, actorId, { name: 'Board' });
    expect(d.name).toBe('Board');
  });

  it('updates nodes and exports', async () => {
    const d = await createDocument(tenantId, actorId, { name: 'Board' });
    await updateDocument(tenantId, actorId, d.id, {
      nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, props: { text: 'Hi' } }],
    });
    const exp = await exportDocument(tenantId, actorId, d.id, 'png');
    expect(exp.url).toContain('.png');
  });

  it('lists templates', () => {
    expect(listTemplates().length).toBeGreaterThan(0);
  });
});
