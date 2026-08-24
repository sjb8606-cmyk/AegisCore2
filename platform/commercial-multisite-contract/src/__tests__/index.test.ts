import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn()
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn()
}));

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn()
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  const actual = await vi.importActual<any>('@platform/crud-kernel');

  return {
    ...actual,
    runCrudOperation: async (options: any) =>
      options.action()
  };
});

import {
  __resetCommercialMultisiteContractStore,
  addSite,
  createContract,
  getConsolidatedInvoice,
  getSiteChecklist
} from '../index';

describe('commercial-multisite-contract', () => {
  beforeEach(() => {
    __resetCommercialMultisiteContractStore();
  });

  it('creates a contract, adds a site, and consolidates billing', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const contract = await createContract(
      tenantId,
      actorId,
      {
        contractId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        sites: []
      }
    );

    const site = await addSite(
      tenantId,
      actorId,
      contract.contractId,
      {
        address: '100 Main Street',
        accessRequirements: {
          offHours: true
        },
        siteChecklistOverride: null
      }
    );

    const invoice = await getConsolidatedInvoice(
      tenantId,
      actorId,
      contract.contractId,
      '2026-09'
    );

    expect(site.address).toBe('100 Main Street');
    expect(invoice.siteCount).toBe(1);
    expect(invoice.consolidated).toBe(true);
  });

  it('rejects a duplicate site ID', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const siteId = crypto.randomUUID();

    const contract = await createContract(
      tenantId,
      actorId,
      {
        contractId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        sites: []
      }
    );

    await addSite(
      tenantId,
      actorId,
      contract.contractId,
      {
        siteId,
        address: '100 Main Street',
        accessRequirements: {},
        siteChecklistOverride: null
      }
    );

    await expect(
      addSite(
        tenantId,
        actorId,
        contract.contractId,
        {
          siteId,
          address: '200 Main Street',
          accessRequirements: {},
          siteChecklistOverride: null
        }
      )
    ).rejects.toThrow();
  });

  it('uses the site checklist override and remains tenant-scoped', async () => {
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    const contract = await createContract(
      tenantId,
      actorId,
      {
        contractId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        sites: []
      }
    );

    const site = await addSite(
      tenantId,
      actorId,
      contract.contractId,
      {
        address: '300 Main Street',
        accessRequirements: {},
        siteChecklistOverride: {
          alarmCodeRequired: true
        }
      }
    );

    const checklist = await getSiteChecklist(
      tenantId,
      actorId,
      site.siteId,
      {
        standardChecklist: true
      }
    );

    expect(checklist).toEqual({
      alarmCodeRequired: true
    });

    await expect(
      getSiteChecklist(
        otherTenantId,
        actorId,
        site.siteId,
        {}
      )
    ).rejects.toThrow();
  });
});
