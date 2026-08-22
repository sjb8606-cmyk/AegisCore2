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
      maxBatchSize: 500,
      maxRetries: 3,
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
  registerSource,
  runIngestion,
  setFetchFn,
  mapRecord,
  validateMapped,
  listNormalized,
  listErrors,
  __resetIngestionEtlStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('ingestion-etl', () => {
  beforeEach(() => {
    __resetIngestionEtlStore();
    vi.clearAllMocks();
  });

  it('maps and validates fields', () => {
    const mapped = mapRecord(
      { temp_c: 12, station: 'A1' },
      { temperature: 'temp_c', stationId: 'station' },
    );
    expect(mapped.temperature).toBe(12);
    expect(validateMapped(mapped, ['temperature', 'stationId'])).toBeNull();
    expect(validateMapped({}, ['temperature'])).toMatch(/missing/);
  });

  it('ingests valid rows and queues errors', async () => {
    const src = await registerSource(tenantId, actorId, {
      name: 'weather-api',
      type: 'api',
      schemaMap: { temperature: 'temp_c', stationId: 'station' },
      requiredFields: ['temperature', 'stationId'],
    });

    setFetchFn(async () => [
      { temp_c: 10, station: 'A1' },
      { temp_c: 11 }, // missing station
      { temp_c: 12, station: 'B2' },
    ]);

    const result = await runIngestion(tenantId, actorId, src.id);
    expect(result.raw).toBe(3);
    expect(result.normalized).toBe(2);
    expect(result.errors).toBe(1);
    expect((await listNormalized(tenantId, src.id)).length).toBe(2);
    expect((await listErrors(tenantId, src.id)).length).toBe(1);
  });

  it('rejects empty schemaMap', async () => {
    await expect(
      registerSource(tenantId, actorId, {
        name: 'bad',
        type: 'file',
        schemaMap: {},
      }),
    ).rejects.toThrow(/schemaMap/i);
  });
});
