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
      requirePatchTestForNewClient: true,
      patchTestValidityDays: 180,
      blockOnFailedPatchTest: true,
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
  logPatchTest,
  logChemicalService,
  getClientColorHistory,
  logAdverseReaction,
  __resetChemicalServiceRecordStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';
const clientId = '00000000-0000-4000-8000-0000000000cc';
const stylistId = '00000000-0000-4000-8000-0000000000bb';

describe('chemical-service-record', () => {
  beforeEach(() => {
    __resetChemicalServiceRecordStore();
    vi.clearAllMocks();
  });

  it('blocks chemical service without patch test', async () => {
    await expect(
      logChemicalService(tenantId, actorId, {
        clientId,
        stylistId,
        serviceType: 'color',
        formula: '6N + 20vol',
      }),
    ).rejects.toThrow(/patch test/i);
  });

  it('logs service after passed patch test and returns history', async () => {
    await logPatchTest(tenantId, actorId, {
      clientId,
      result: 'passed',
    });
    const rec = await logChemicalService(tenantId, actorId, {
      clientId,
      stylistId,
      serviceType: 'color',
      formula: '7G + 20vol',
      developerVolume: '20',
      products: [{ name: 'BrandX 7G', lotNumber: 'L-1' }],
    });
    expect(rec.formula).toContain('7G');
    const hist = await getClientColorHistory(tenantId, actorId, clientId);
    expect(hist).toHaveLength(1);
  });

  it('blocks on failed patch test and logs adverse reaction', async () => {
    await logPatchTest(tenantId, actorId, {
      clientId,
      result: 'passed',
    });
    const rec = await logChemicalService(tenantId, actorId, {
      clientId,
      stylistId,
      serviceType: 'bleach',
      formula: 'bleach wash',
    });
    await logAdverseReaction(tenantId, actorId, rec.id, 'Scalp irritation');
    await expect(
      logChemicalService(tenantId, actorId, {
        clientId,
        stylistId,
        serviceType: 'color',
        formula: 'x',
        patchTestResult: 'failed',
      }),
    ).rejects.toThrow(/failed patch test/i);
  });
});
