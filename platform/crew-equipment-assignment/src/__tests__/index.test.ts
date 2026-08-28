import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  __resetCrewEquipmentAssignmentStore,
  assignCrew,
  assignEquipment,
  checkAvailability,
  checkEquipmentConflict
} from '../index';

describe('crew-equipment-assignment', () => {
  beforeEach(() => {
    __resetCrewEquipmentAssignmentStore();
  });

  it('assigns crew and equipment to a visit', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const visitId = crypto.randomUUID();
    const crewId = crypto.randomUUID();
    const equipmentId = crypto.randomUUID();

    const assignment = await assignCrew(
      tenantId,
      actorId,
      visitId,
      [crewId],
      '2026-09-01'
    );

    const updated = await assignEquipment(
      tenantId,
      actorId,
      visitId,
      [equipmentId],
      '2026-09-01'
    );

    expect(assignment.visitId).toBe(visitId);
    expect(updated.crewMemberIds).toEqual([crewId]);
    expect(updated.equipmentIds).toEqual([equipmentId]);
  });

  it('rejects a crew member conflict', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const crewId = crypto.randomUUID();

    await assignCrew(
      tenantId,
      actorId,
      crypto.randomUUID(),
      [crewId],
      '2026-09-02'
    );

    await expect(
      assignCrew(
        tenantId,
        actorId,
        crypto.randomUUID(),
        [crewId],
        '2026-09-02'
      )
    ).rejects.toThrow();
  });

  it('reports equipment availability and conflicts', async () => {
    const tenantId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const visitId = crypto.randomUUID();
    const equipmentId = crypto.randomUUID();

    await assignCrew(
      tenantId,
      actorId,
      visitId,
      [crypto.randomUUID()],
      '2026-09-03'
    );

    await assignEquipment(
      tenantId,
      actorId,
      visitId,
      [equipmentId],
      '2026-09-03'
    );

    const available = await checkAvailability(
      tenantId,
      actorId,
      crypto.randomUUID(),
      '2026-09-03'
    );

    const conflict = await checkEquipmentConflict(
      tenantId,
      actorId,
      equipmentId,
      '2026-09-03'
    );

    expect(available).toBe(true);
    expect(conflict).toBe(true);
  });
});
