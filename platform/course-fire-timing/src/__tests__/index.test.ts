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
      defaultCourses: ['appetizer', 'entree', 'dessert'],
      autoFireNextOnBump: false,
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
  openCourseTicket,
  fireCourse,
  bumpCourse,
  getKitchenCourseQueue,
  __resetCourseFireStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('course-fire-timing', () => {
  beforeEach(() => {
    __resetCourseFireStore();
    vi.clearAllMocks();
  });

  it('opens ticket with default courses held', async () => {
    const ticket = await openCourseTicket(tenantId, actorId, {
      orderId: crypto.randomUUID(),
      tableLabel: '12',
    });
    expect(ticket.courses).toHaveLength(3);
    expect(ticket.courses.every((c) => c.state === 'held')).toBe(true);
  });

  it('fires then bumps a course into kitchen queue lifecycle', async () => {
    const ticket = await openCourseTicket(tenantId, actorId, {
      orderId: crypto.randomUUID(),
    });
    await fireCourse(tenantId, actorId, ticket.id, 'appetizer');
    const queue = await getKitchenCourseQueue(tenantId, actorId);
    expect(queue).toHaveLength(1);
    expect(queue[0].courseName).toBe('appetizer');
    const bumped = await bumpCourse(tenantId, actorId, ticket.id, 'appetizer');
    expect(
      bumped.courses.find((c) => c.name === 'appetizer')?.state,
    ).toBe('bumped');
    const after = await getKitchenCourseQueue(tenantId, actorId);
    expect(after).toHaveLength(0);
  });

  it('rejects bump before fire', async () => {
    const ticket = await openCourseTicket(tenantId, actorId, {
      orderId: crypto.randomUUID(),
    });
    await expect(
      bumpCourse(tenantId, actorId, ticket.id, 'entree'),
    ).rejects.toThrow(/fired/i);
  });
});
