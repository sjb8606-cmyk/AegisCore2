/**
 * @platform/onboarding
 * BUG: createFlow reads data.steps.length with no guard → raw TypeError when steps missing.
 * GAP: no list/get/delete flow or progress APIs despite tables being written.
 * LIMITATION: loadConfig is private + disk-based (mocked via fs).
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
  parseUserId: (id: string) => {
    if (!id || id.length < 8) throw Object.assign(new Error('Invalid user id'), { code: 'BAD_REQUEST' });
    return id;
  },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

import { createFlow, startFlow, completeStep, AppError, ErrorCode } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const FLOW = '33333333-3333-3333-3333-333333333333';

describe('onboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('createFlow', () => {
    it('FORBIDDEN when disabled via config', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ enabled: false, limits: { flowCount: 5, stepsPerFlow: 10 } }));
      await expect(createFlow(TENANT, USER, { name: 'Welcome', steps: [] }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/disabled/i) });
    });

    it('BAD_REQUEST when steps exceed stepsPerFlow', async () => {
      const steps = Array.from({ length: 11 }, (_, i) => ({ id: i, title: `S${i}` }));
      await expect(createFlow(TENANT, USER, { name: 'Too many', steps }))
        .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/Steps count limit/i) });
    });

    it('FORBIDDEN when flowCount already reached', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '5' }]);
      await expect(createFlow(TENANT, USER, { name: 'One more', steps: [{ id: 0, title: 'A' }] }))
        .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/limits reached/i) });
    });

    it('inserts and returns the flow row on success', async () => {
      const inserted = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tenant_id: TENANT, name: 'New Hire' };
      mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([inserted]);
      const result = await createFlow(TENANT, USER, {
        name: 'New Hire', target_role: 'engineer', steps: [{ id: 0, title: 'Setup' }],
      });
      expect(result).toEqual(inserted);
      expect(mockWithTenantQuery.mock.calls[1][0]).toMatch(/INSERT INTO onboarding_flows/i);
      expect(mockWithTenantQuery.mock.calls[1][1][2]).toBe('New Hire');
    });

    // BUG lock-in: missing steps → TypeError, not AppError
    it('currently throws TypeError when steps is missing (BUG – should be AppError BAD_REQUEST)', async () => {
      await expect(createFlow(TENANT, USER, { name: 'No steps' })).rejects.toThrow(TypeError);
    });
  });

  describe('startFlow', () => {
    it('upserts progress and returns the row', async () => {
      const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', tenant_id: TENANT, flow_id: FLOW, user_id: USER, status: 'in_progress' };
      mockWithTenantQuery.mockResolvedValueOnce([row]);
      const result = await startFlow(TENANT, USER, FLOW);
      expect(result).toEqual(row);
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/INSERT INTO onboarding_progress/i);
      expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/ON CONFLICT \(flow_id, user_id\)/i);
    });
  });

  describe('completeStep', () => {
    it('NOT_FOUND when no progress row', async () => {
      mockWithTenantQuery.mockResolvedValueOnce([]);
      await expect(completeStep(TENANT, USER, 0)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND, message: expect.stringMatching(/No active progress/i),
      });
    });

    it('appends stepId, advances current_step, returns updated row', async () => {
      const existing = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', tenant_id: TENANT, user_id: USER, completed_steps: [0], current_step: 1 };
      const updated = { ...existing, completed_steps: [0, 1], current_step: 2 };
      mockWithTenantQuery.mockResolvedValueOnce([existing]).mockResolvedValueOnce([updated]);
      const result = await completeStep(TENANT, USER, 1);
      expect(result).toEqual(updated);
      expect(mockWithTenantQuery.mock.calls[1][1][0]).toEqual([0, 1]);
      expect(mockWithTenantQuery.mock.calls[1][1][1]).toBe(2);
    });

    it('deduplicates completed_steps via Set', async () => {
      const existing = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', tenant_id: TENANT, user_id: USER, completed_steps: [0, 1], current_step: 2 };
      mockWithTenantQuery.mockResolvedValueOnce([existing]).mockResolvedValueOnce([{ ...existing }]);
      await completeStep(TENANT, USER, 1);
      expect(mockWithTenantQuery.mock.calls[1][1][0]).toEqual([0, 1]);
    });
  });
});
