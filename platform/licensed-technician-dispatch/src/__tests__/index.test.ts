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
  __registerTechnician,
  __resetLicensedTechnicianDispatchStore,
  assignJob,
  createDispatchJob,
  escalatePriority,
  matchTechnician
} from '../index';

describe('licensed-technician-dispatch', () => {
  beforeEach(() => {
    __resetLicensedTechnicianDispatchStore();
  });

  it('matches a technician by license and availability', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const technicianId = crypto.randomUUID();

    __registerTechnician({
      technicianId,
      tenantId,
      licenseTypes: ['hvac'],
      availableDates: ['2026-08-25']
    });

    const job = await createDispatchJob(
      tenantId,
      actorId,
      'hvac',
      new Date('2026-08-25')
    );

    const match = await matchTechnician(
      tenantId,
      actorId,
      job.jobId
    );

    expect(match?.technicianId)
      .toBe(technicianId);
  });

  it('rejects assignment when the technician lacks the required license', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const technicianId = crypto.randomUUID();

    __registerTechnician({
      technicianId,
      tenantId,
      licenseTypes: ['electrical'],
      availableDates: ['2026-08-25']
    });

    const job = await createDispatchJob(
      tenantId,
      actorId,
      'plumbing',
      new Date('2026-08-25')
    );

    await expect(
      assignJob(
        tenantId,
        actorId,
        job.jobId,
        technicianId
      )
    ).rejects.toThrow();
  });

  it('assigns a valid technician and escalates priority', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const technicianId = crypto.randomUUID();

    __registerTechnician({
      technicianId,
      tenantId,
      licenseTypes: ['gas_fitting'],
      availableDates: ['2026-08-25']
    });

    const job = await createDispatchJob(
      tenantId,
      actorId,
      'gas_fitting',
      new Date('2026-08-25')
    );

    const assigned = await assignJob(
      tenantId,
      actorId,
      job.jobId,
      technicianId
    );

    const escalated = await escalatePriority(
      tenantId,
      actorId,
      job.jobId,
      'emergency'
    );

    expect(assigned.status)
      .toBe('assigned');
    expect(assigned.technicianId)
      .toBe(technicianId);
    expect(escalated.priority)
      .toBe('emergency');
  });
});
