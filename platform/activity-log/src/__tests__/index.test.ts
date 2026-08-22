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
      jobTypeProfiles: [
        {
          jobType: 'service',
          measurementFields: [
            { key: 'pressure_psi', unit: 'psi', required: true },
          ],
          checklistItems: ['Safety PPE', 'Area cleared'],
          requiredPhotoCount: 1,
        },
      ],
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
  createLog,
  listByJob,
  attachPhoto,
  __resetActivityLogStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('activity-log', () => {
  beforeEach(() => {
    __resetActivityLogStore();
    vi.clearAllMocks();
  });

  it('creates a valid service log', async () => {
    const entry = await createLog(tenantId, actorId, {
      jobId: 'job-1',
      jobType: 'service',
      notes: 'Replaced filter',
      measurements: [{ key: 'pressure_psi', value: 42, unit: 'psi' }],
      photos: ['s3://photos/1.jpg'],
      checklistResults: [
        { item: 'Safety PPE', passed: true },
        { item: 'Area cleared', passed: true },
      ],
    });
    expect(entry.id).toBeTruthy();
    const list = await listByJob(tenantId, 'job-1');
    expect(list).toHaveLength(1);
  });

  it('rejects missing required measurement / photo / checklist', async () => {
    await expect(
      createLog(tenantId, actorId, {
        jobId: 'job-2',
        jobType: 'service',
        measurements: [],
        photos: [],
        checklistResults: [],
      }),
    ).rejects.toThrow(/missing measurement/i);
  });

  it('attaches additional photo', async () => {
    const entry = await createLog(tenantId, actorId, {
      jobId: 'job-3',
      jobType: 'service',
      measurements: [{ key: 'pressure_psi', value: 30 }],
      photos: ['s3://photos/a.jpg'],
      checklistResults: [
        { item: 'Safety PPE', passed: true },
        { item: 'Area cleared', passed: true },
      ],
    });
    const updated = await attachPhoto(
      tenantId,
      actorId,
      entry.id,
      's3://photos/b.jpg',
    );
    expect(updated.photos).toHaveLength(2);
  });
});
