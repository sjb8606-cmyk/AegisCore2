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
      defaultPrefix: 'REF',
      format: 'sequential',
      dateFormat: 'YYYYMMDD',
      seqPad: 4,
      randomLen: 6,
      separator: '-',
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
  generate,
  formatDateKey,
  buildId,
  isIssued,
  __resetReferenceIdStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('reference-id', () => {
  beforeEach(() => {
    __resetReferenceIdStore();
    vi.clearAllMocks();
  });

  it('formats date keys', () => {
    const d = new Date(Date.UTC(2026, 7, 21)); // Aug 21 2026
    expect(formatDateKey(d, 'YYYYMMDD')).toBe('20260821');
    expect(formatDateKey(d, 'YYMMDD')).toBe('260821');
    expect(formatDateKey(d, 'none')).toBe('');
  });

  it('issues sequential ids', async () => {
    const a = await generate(tenantId, actorId, { prefix: 'INV' });
    const b = await generate(tenantId, actorId, { prefix: 'INV' });
    expect(a.id).toMatch(/^INV-\d{8}-0001$/);
    expect(b.id).toMatch(/^INV-\d{8}-0002$/);
    expect(isIssued(tenantId, a.id)).toBe(true);
  });

  it('issues random ids', async () => {
    const r = await generate(tenantId, actorId, {
      prefix: 'BAT',
      format: 'random',
    });
    expect(r.id).toMatch(/^BAT-\d{8}-[A-Z0-9]{6}$/);
  });

  it('buildId joins parts', () => {
    expect(buildId('JOB', '20260101', '0042', '-')).toBe('JOB-20260101-0042');
  });
});
