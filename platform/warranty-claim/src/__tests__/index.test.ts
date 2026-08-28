import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
  loadConfig: vi.fn()

  };
});

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>(
    '@platform/crud-kernel'
  );

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetWarrantyClaimStore,
  __setWarrantyStatus,
  checkWarrantyStatus,
  fileClaim,
  updateClaimStatus
} from '../index';

describe('warranty-claim', () => {
  beforeEach(() => {
    __resetWarrantyClaimStore();
  });

  it('files a claim using the equipment warranty status', async () => {
    const tenantId = crypto.randomUUID();
    const equipmentId = crypto.randomUUID();

    __setWarrantyStatus(
      tenantId,
      equipmentId,
      'active'
    );

    const claim = await fileClaim(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      equipmentId,
      'Compressor failed during normal operation'
    );

    expect(
      claim.manufacturerWarrantyStatus
    ).toBe('active');

    expect(claim.claimStatus)
      .toBe('filed');
  });

  it('requires resolution notes when resolving a claim', async () => {
    const tenantId = crypto.randomUUID();

    const claim = await fileClaim(
      tenantId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'Motor failure'
    );

    await expect(
      updateClaimStatus(
        tenantId,
        crypto.randomUUID(),
        claim.claimId,
        'resolved'
      )
    ).rejects.toThrow();
  });

  it('keeps warranty status tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const equipmentId = crypto.randomUUID();

    __setWarrantyStatus(
      tenantId,
      equipmentId,
      'active'
    );

    const status = await checkWarrantyStatus(
      otherTenantId,
      crypto.randomUUID(),
      equipmentId
    );

    expect(status).toBe('unknown');
  });
});
