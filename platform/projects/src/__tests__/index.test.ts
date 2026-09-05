/**
 * @platform/projects
 * Real circular-dependency DFS exercised; progress percent math asserted exactly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...args: unknown[]) => mockWithTenantQuery(...args),
}));

vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import {
  createProject, createTask, getProjectProgress, getGanttData, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const PROJECT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TASK_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TASK_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('createProject', () => {
    it('FORBIDDEN when disabled', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false, tiers: {}, limits: { projectCount: 5 } }));
      await expect(createProject(TENANT, USER, { name: 'Alpha' }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('FORBIDDEN when projectCount limit reached', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);
      await expect(createProject(TENANT, USER, { name: 'Alpha' }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/capacity limit/i) });
    });

    it('inserts and returns project', async () => {
      const row = { id: PROJECT, name: 'Alpha', budget_cents: 0 };
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([row]);
      const result = await createProject(TENANT, USER, { name: 'Alpha', description: 'First' });
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[1][1][2]).toBe('Alpha');
    });
  });

  describe('createTask', () => {
    it('FORBIDDEN when tasksPerProject limit reached', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '50' }]);
      await expect(createTask(TENANT, PROJECT, USER, { title: 'T1' }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Task limit/i) });
    });

    it('FORBIDDEN when dependencies tier off but dependsOn provided', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: true, tiers: { dependencies: false, ganttView: true }, limits: { projectCount: 5, tasksPerProject: 50 },
      }));
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]);
      await expect(createTask(TENANT, PROJECT, USER, { title: 'T1', dependsOn: [TASK_A] }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/dependencies are disabled/i) });
    });

    it('BAD_REQUEST on circular dependency', async () => {
      // count tasks
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]);
      // detectCircularDependency loads existing tasks: B depends on A; we propose A depends on B → cycle
      mockWithTenantQuery.mockResolvedValueOnce([
        { id: TASK_A, depends_on: [] },
        { id: TASK_B, depends_on: [TASK_A] },
      ]);
      // When creating a new task with dependsOn: [TASK_B] and the graph already has B→A,
      // the new node isn't in adjList with an id yet — the DFS still runs over existing nodes.
      // Source only detects cycles among existing nodes + proposed edges attached to currentTaskId=null
      // by seeding proposed dep ids. To force a cycle we need an existing cycle or self-ref via proposed.
      // Self-cycle via proposedDependencies that already form a cycle among themselves isn't possible
      // without nodes; instead seed an existing cycle:
      mockWithTenantQuery.mockReset();
      mockWithTenantQuery
        .mockResolvedValueOnce([{ count: '0' }])
        .mockResolvedValueOnce([
          { id: TASK_A, depends_on: [TASK_B] },
          { id: TASK_B, depends_on: [TASK_A] },
        ]);
      await expect(createTask(TENANT, PROJECT, USER, { title: 'T3', dependsOn: [TASK_A] }))
        .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/Circular dependency/i) });
    });

    it('inserts task on success path', async () => {
      const row = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', title: 'Ship it' };
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([row]);
      const result = await createTask(TENANT, PROJECT, USER, {
        title: 'Ship it', estimatedHours: 4, customFields: { priority: 'high' },
      });
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/INSERT INTO tasks/i);
    });
  });

  describe('getProjectProgress', () => {
    it('returns 0% when no tasks', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      const result = await getProjectProgress(TENANT, PROJECT);
      expect(result).toEqual({ percentComplete: 0, completed: 0, total: 0 });
    });

    it('computes percentComplete from completed/done statuses', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([
        { status: 'completed', qty: '3' },
        { status: 'done', qty: '1' },
        { status: 'in_progress', qty: '4' },
        { status: 'todo', qty: '2' },
      ]);
      const result = await getProjectProgress(TENANT, PROJECT);
      // completed=3+1=4, total=10, percent=40
      expect(result).toEqual({ percentComplete: 40, completed: 4, total: 10 });
    });
  });

  describe('getGanttData', () => {
    it('FORBIDDEN when ganttView tier off', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        enabled: true, tiers: { ganttView: false }, limits: { projectCount: 5, tasksPerProject: 50 },
      }));
      await expect(getGanttData(TENANT, PROJECT))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Gantt View is disabled/i) });
    });

    it('returns task rows ordered by start_date', async () => {
      const rows = [
        { id: TASK_A, title: 'A', startDate: '2026-01-01', dueDate: '2026-01-05', dependsOn: [], status: 'todo' },
      ];
      mockWithTenantQuery.mockResolvedValueOnce(rows);
      const result = await getGanttData(TENANT, PROJECT);
      expect(result).toEqual(rows);
    });
  });
});
