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
      defaultPeriod: 'monthly',
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
  createPartner,
  listPartners,
  __resetCsrPartnersStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('csr-partners', () => {
  beforeEach(() => {
    __resetCsrPartnersStore();
    vi.clearAllMocks();
  });

  it('creates partner', async () => {
    const p = await createPartner(tenantId, actorId, {
      companyName: 'Acme Corp',
      contactEmail: 'csr@acme.com',
      pledgedHoursPerPeriod: 40,
    });
    expect(p.companyName).toBe('Acme Corp');
    expect(p.period).toBe('monthly');
  });

  it('lists partners', async () => {
    await createPartner(tenantId, actorId, {
      companyName: 'Acme',
      contactEmail: 'a@acme.com',
      pledgedHoursPerPeriod: 10,
    });
    expect(await listPartners(tenantId)).toHaveLength(1);
  });
});
